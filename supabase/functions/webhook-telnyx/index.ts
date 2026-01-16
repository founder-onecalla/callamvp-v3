import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ============================================================================
// WEBHOOK HANDLER - With Checkpoint Logging and Silence Watchdog
// ============================================================================
// This handler logs all pipeline checkpoints and implements a watchdog timer
// to detect and handle silence (no ASR after TTS).
// ============================================================================

// Silence timeout in milliseconds (3 seconds)
const SILENCE_TIMEOUT_MS = 3000

interface IvrStep {
  step: number
  prompt: string
  action: string
  note: string
}

interface CallContext {
  id: string
  ivr_path_id: string | null
  gathered_info: Record<string, string>
  status: string
}

interface IvrPath {
  id: string
  company_name: string
  department: string
  menu_path: IvrStep[]
}

// Helper to log call events
async function logCallEvent(
  serviceClient: ReturnType<typeof createClient>,
  callId: string,
  eventType: string,
  description: string,
  metadata: Record<string, unknown> = {}
) {
  try {
    await serviceClient.from('call_events').insert({
      call_id: callId,
      event_type: eventType,
      description,
      metadata,
    })
  } catch (error) {
    console.error('Failed to log call event:', error)
  }
}

// Log checkpoint with timestamp
async function logCheckpoint(
  serviceClient: ReturnType<typeof createClient>,
  callId: string,
  checkpoint: string,
  details?: Record<string, unknown>
) {
  try {
    const timestamp = new Date().toISOString()

    // Log as event
    await serviceClient.from('call_events').insert({
      call_id: callId,
      event_type: 'checkpoint',
      description: checkpoint,
      metadata: { checkpoint, timestamp, ...details }
    })

    // Update pipeline_checkpoints on call record
    const { data: call } = await serviceClient
      .from('calls')
      .select('pipeline_checkpoints')
      .eq('id', callId)
      .single()

    const checkpoints = call?.pipeline_checkpoints || {}
    checkpoints[checkpoint] = timestamp

    await serviceClient.from('calls').update({
      pipeline_checkpoints: checkpoints,
      last_activity_at: timestamp
    }).eq('id', callId)

    console.log(`[webhook] Checkpoint: ${checkpoint}`, details || '')
  } catch (err) {
    console.error('[webhook] Failed to log checkpoint:', err)
  }
}

// Helper to send DTMF tones
async function sendDtmf(
  callControlId: string,
  digits: string,
  telnyxApiKey: string,
  serviceClient: ReturnType<typeof createClient>,
  callId: string
) {
  try {
    await fetch(
      `https://api.telnyx.com/v2/calls/${callControlId}/actions/send_dtmf`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${telnyxApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ digits }),
      }
    )
    console.log(`Sent DTMF: ${digits}`)
    await logCallEvent(serviceClient, callId, 'dtmf_sent', `Pressed ${digits}`, { digits })
  } catch (error) {
    console.error('Failed to send DTMF:', error)
    await logCallEvent(serviceClient, callId, 'error', `Failed to send DTMF: ${digits}`, { digits, error: String(error) })
  }
}

// Helper to delay execution
function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Farewell phrases for mutual goodbye detection
const FAREWELL_PHRASES = [
  'bye', 'goodbye', 'good bye', 'talk to you later', 'have a good day',
  'have a good one', 'thanks bye', 'thank you bye', 'ok bye', 'okay bye',
  'alright bye', 'take care', 'see you', 'later', 'that\'s all',
  'appreciate it bye', 'thanks so much bye', 'you too bye'
]

// Continuation markers - abort closing if detected
const CONTINUATION_MARKERS = [
  'wait', 'actually', 'one more thing', 'hold on', 'before you go',
  'can you also', 'i also need', 'i have another', 'quick question',
  'also', 'oh wait', 'sorry', 'one second'
]

function isFarewell(text: string): boolean {
  const lower = text.toLowerCase().trim()
  return FAREWELL_PHRASES.some(phrase => lower.includes(phrase))
}

function isContinuation(text: string): boolean {
  const lower = text.toLowerCase().trim()
  if (CONTINUATION_MARKERS.some(marker => lower.includes(marker))) return true
  if (lower.includes('?')) return true
  return false
}

// Helper to hang up the call
async function hangupCall(
  callControlId: string,
  telnyxApiKey: string,
  serviceClient: ReturnType<typeof createClient>,
  callId: string,
  reason: string
) {
  console.log(`[webhook] Hanging up call ${callId}, reason: ${reason}`)

  try {
    const response = await fetch(
      `https://api.telnyx.com/v2/calls/${callControlId}/actions/hangup`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${telnyxApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }
    )

    if (response.ok) {
      console.log(`[webhook] Hangup successful: ${reason}`)
      await logCheckpoint(serviceClient, callId, 'call_ended', { reason })
      await logCallEvent(serviceClient, callId, 'hangup', `Call ended: ${reason}`, { reason })
    } else {
      console.error(`[webhook] Hangup failed:`, await response.text())
    }
  } catch (error) {
    console.error(`[webhook] Hangup error:`, error)
  }
}

// Helper to trigger voice agent
async function triggerVoiceAgent(
  supabaseUrl: string,
  serviceRoleKey: string,
  callId: string,
  transcription?: string,
  isOpening = false,
  isReprompt = false
) {
  const url = `${supabaseUrl}/functions/v1/voice-agent`
  console.log('[webhook] triggerVoiceAgent:', { callId, isOpening, isReprompt, hasTranscription: !!transcription })

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        call_id: callId,
        transcription,
        is_opening: isOpening,
        is_reprompt: isReprompt,
      }),
    })

    const responseText = await response.text()
    console.log('[webhook] triggerVoiceAgent response:', response.status, responseText.substring(0, 200))

    if (!response.ok) {
      console.error('[webhook] triggerVoiceAgent FAILED:', response.status)
      throw new Error(`Voice agent returned ${response.status}: ${responseText}`)
    }

    console.log('[webhook] triggerVoiceAgent SUCCESS')
    return JSON.parse(responseText)
  } catch (error) {
    console.error('[webhook] triggerVoiceAgent ERROR:', error)
    throw error
  }
}

// Helper to start transcription on a call
async function startTranscription(
  callControlId: string,
  telnyxApiKey: string,
  callId: string,
  serviceClient: ReturnType<typeof createClient>
) {
  try {
    console.log('[webhook] Starting transcription for call:', callControlId)
    console.log('[webhook] transcription_start config:', JSON.stringify({
      language: 'en',
      transcription_tracks: 'both',
    }))

    const response = await fetch(
      `https://api.telnyx.com/v2/calls/${callControlId}/actions/transcription_start`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${telnyxApiKey}`,
          'Content-Type': 'application/json',
        },
        // CRITICAL: transcription_tracks must capture both legs
        // 'both' = inbound (us) + outbound (them)
        // Alternative: If 'both' doesn't work, we may need 'outbound' to get callee audio
        body: JSON.stringify({
          language: 'en',
          transcription_tracks: 'both',
          // Enable interim results to get faster feedback
          interim_results: true,
        }),
      }
    )

    const responseText = await response.text()
    console.log('[webhook] transcription_start response status:', response.status)
    console.log('[webhook] transcription_start response body:', responseText)

    if (!response.ok) {
      console.error('[webhook] ❌ FAILED to start transcription:', responseText)
      await logCallEvent(serviceClient, callId, 'error', 'Failed to start transcription', {
        error: responseText,
        status: response.status
      })
      await logCheckpoint(serviceClient, callId, 'transcription_start_failed', {
        error: responseText,
        status: response.status
      })
    } else {
      console.log('[webhook] ✅ Transcription started successfully')
      await logCheckpoint(serviceClient, callId, 'transcription_started', {
        config: { language: 'en', transcription_tracks: 'both' },
        response: responseText
      })
      await logCallEvent(serviceClient, callId, 'transcription_started', 'Listening to conversation (both tracks)', {
        config: { language: 'en', transcription_tracks: 'both' }
      })

      // Initialize audio health tracking
      await serviceClient.from('calls').update({
        inbound_audio_health: {
          transcription_started: true,
          started_at: new Date().toISOString(),
          self_transcripts_received: 0,
          remote_transcripts_received: 0,
          last_self_transcript_at: null,
          last_remote_transcript_at: null,
        }
      }).eq('id', callId)
    }
  } catch (error) {
    console.error('[webhook] ❌ Transcription start exception:', error)
    await logCheckpoint(serviceClient, callId, 'transcription_start_exception', { error: String(error) })
  }
}

// Set up silence watchdog - will trigger reprompt if no ASR within timeout
async function startSilenceWatchdog(
  serviceClient: ReturnType<typeof createClient>,
  callId: string
) {
  try {
    await serviceClient.from('calls').update({
      silence_started_at: new Date().toISOString()
    }).eq('id', callId)
    console.log('[webhook] Silence watchdog started for call:', callId)
  } catch (err) {
    console.error('[webhook] Failed to start silence watchdog:', err)
  }
}

// Check if silence watchdog should trigger reprompt
async function checkSilenceWatchdog(
  serviceClient: ReturnType<typeof createClient>,
  callId: string,
  supabaseUrl: string,
  serviceRoleKey: string,
  telnyxApiKey: string
): Promise<boolean> {
  try {
    const { data: call } = await serviceClient
      .from('calls')
      .select('silence_started_at, reprompt_count, telnyx_call_id, status, closing_state')
      .eq('id', callId)
      .single()

    if (!call || call.status !== 'answered' || call.closing_state === 'closing_said') {
      return false
    }

    if (!call.silence_started_at) {
      return false
    }

    const silenceStarted = new Date(call.silence_started_at)
    const now = new Date()
    const silenceMs = now.getTime() - silenceStarted.getTime()

    if (silenceMs >= SILENCE_TIMEOUT_MS) {
      console.log(`[webhook] Silence timeout reached (${silenceMs}ms), triggering reprompt`)
      await logCheckpoint(serviceClient, callId, 'silence_timeout', { silenceMs })

      // Trigger reprompt
      await triggerVoiceAgent(supabaseUrl, serviceRoleKey, callId, undefined, false, true)
      return true
    }

    return false
  } catch (err) {
    console.error('[webhook] Failed to check silence watchdog:', err)
    return false
  }
}

serve(async (req) => {
  console.log('[webhook-telnyx] ========== REQUEST RECEIVED ==========')
  console.log('[webhook-telnyx] Method:', req.method)
  console.log('[webhook-telnyx] URL:', req.url)

  if (req.method === 'OPTIONS') {
    console.log('[webhook-telnyx] Responding to OPTIONS preflight')
    return new Response('ok', { headers: corsHeaders })
  }

  // Health check for GET requests
  if (req.method === 'GET') {
    console.log('[webhook-telnyx] Health check - responding OK')
    return new Response(JSON.stringify({ status: 'ok', message: 'Webhook is accessible' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const rawBody = await req.text()
    console.log('[webhook-telnyx] Raw body length:', rawBody.length)
    console.log('[webhook-telnyx] Raw body preview:', rawBody.substring(0, 500))

    const body = JSON.parse(rawBody)
    const event = body.data
    const eventType = event?.event_type

    console.log('[webhook-telnyx] ========== TELNYX EVENT ==========')
    console.log('[webhook-telnyx] Event type:', eventType)
    console.log('[webhook-telnyx] Event ID:', event?.id)
    console.log('[webhook-telnyx] Occurred at:', event?.occurred_at)
    console.log('[webhook-telnyx] Record type:', event?.record_type)

    // Log all transcription-related events with full payload for diagnosis
    if (eventType?.includes('transcription')) {
      console.log('[webhook-telnyx] ====== TRANSCRIPTION EVENT FULL DUMP ======')
      console.log('[webhook-telnyx] FULL EVENT:', JSON.stringify(event, null, 2))
      console.log('[webhook-telnyx] =============================================')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    const serviceClient = createClient(supabaseUrl, serviceRoleKey)

    // Decode client state to get our call_id
    let callId: string | null = null
    let userId: string | null = null

    if (event.payload?.client_state) {
      try {
        const clientState = JSON.parse(atob(event.payload.client_state))
        callId = clientState.call_id
        userId = clientState.user_id
      } catch (e) {
        console.error('Failed to decode client_state:', e)
      }
    }

    // If no client_state, try to find call by telnyx_call_id
    if (!callId && event.payload?.call_control_id) {
      const { data: call } = await serviceClient
        .from('calls')
        .select('id, user_id')
        .eq('telnyx_call_id', event.payload.call_control_id)
        .single()

      if (call) {
        callId = call.id
        userId = call.user_id
      }
    }

    if (!callId) {
      console.log('No call_id found for event:', eventType)
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const telnyxApiKey = Deno.env.get('TELNYX_API_KEY')

    switch (eventType) {
      case 'call.initiated':
        await logCheckpoint(serviceClient, callId, 'call_started')
        await serviceClient
          .from('calls')
          .update({
            status: 'ringing',
            telnyx_call_id: event.payload.call_control_id,
          })
          .eq('id', callId)
        await logCallEvent(serviceClient, callId, 'status_change', 'Ringing...', { status: 'ringing' })
        break

      case 'call.answered':
        await logCheckpoint(serviceClient, callId, 'call_answered')
        await serviceClient
          .from('calls')
          .update({
            status: 'answered',
            started_at: new Date().toISOString(),
            reprompt_count: 0,
            silence_started_at: null,
          })
          .eq('id', callId)

        await logCallEvent(serviceClient, callId, 'status_change', 'Call connected', { status: 'answered' })

        // Legacy mode: Telnyx transcription + voice-agent function
        console.log('[webhook] ========== CALL ANSWERED - STARTING PIPELINE ==========')

        if (telnyxApiKey && callId) {
          // Start transcription first
          console.log('[webhook] Step 1: Starting transcription...')
          await startTranscription(event.payload.call_control_id, telnyxApiKey, callId, serviceClient)

          // Trigger voice agent opening greeting
          console.log('[webhook] Step 2: Triggering voice agent opening...')
          try {
            await triggerVoiceAgent(supabaseUrl, serviceRoleKey, callId, undefined, true, false)
            console.log('[webhook] Voice agent trigger completed')

            // Start silence watchdog after TTS is sent
            await startSilenceWatchdog(serviceClient, callId)
          } catch (voiceErr) {
            console.error('[webhook] Voice agent trigger FAILED:', voiceErr)
            await logCallEvent(serviceClient, callId, 'error', 'Failed to trigger voice agent', { error: String(voiceErr) })
          }
        } else {
          console.error('[webhook] Cannot start pipeline - missing telnyxApiKey or callId')
        }

        // Check for IVR path and auto-navigate
        if (telnyxApiKey) {
          const { data: context } = await serviceClient
            .from('call_contexts')
            .select('id, ivr_path_id, gathered_info, status')
            .eq('call_id', callId)
            .maybeSingle() as { data: CallContext | null }

          if (context?.ivr_path_id) {
            const { data: ivrPath } = await serviceClient
              .from('ivr_paths')
              .select('id, company_name, department, menu_path')
              .eq('id', context.ivr_path_id)
              .single() as { data: IvrPath | null }

            if (ivrPath?.menu_path && Array.isArray(ivrPath.menu_path)) {
              console.log(`Starting IVR navigation for ${ivrPath.company_name}`)
              await logCallEvent(serviceClient, callId, 'ivr_navigation', `Navigating ${ivrPath.company_name} phone menu`, {
                company: ivrPath.company_name,
                department: ivrPath.department
              })

              await serviceClient
                .from('call_contexts')
                .update({ status: 'in_call' })
                .eq('id', context.id)

              for (const step of ivrPath.menu_path) {
                await delay(3000)

                let digits = step.action
                if (step.action.includes('_')) {
                  const infoKey = step.action
                  if (context.gathered_info && context.gathered_info[infoKey]) {
                    digits = context.gathered_info[infoKey]
                  } else {
                    continue
                  }
                }

                await sendDtmf(event.payload.call_control_id, digits, telnyxApiKey, serviceClient, callId)
              }

              await logCallEvent(serviceClient, callId, 'ivr_navigation', 'Menu navigation complete', {})
            }
          }
        }
        break

      case 'call.hangup': {
        const { data: existingCall } = await serviceClient
          .from('calls')
          .select('started_at, amd_result')
          .eq('id', callId)
          .single()

        const endedAt = new Date()
        let durationSeconds = null

        if (existingCall?.started_at) {
          const startedAt = new Date(existingCall.started_at)
          durationSeconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000)
        }

        const hangupCause = event.payload?.hangup_cause || 'normal'
        let outcome = 'completed'
        let hangupDescription = 'Call ended'

        if (hangupCause === 'normal_clearing' || hangupCause === 'normal') {
          outcome = existingCall?.amd_result === 'machine' ? 'voicemail' : 'completed'
          hangupDescription = outcome === 'voicemail' ? 'Left voicemail' : 'Call completed'
        } else if (hangupCause === 'busy') {
          outcome = 'busy'
          hangupDescription = 'Line was busy'
        } else if (hangupCause === 'no_answer') {
          outcome = 'no_answer'
          hangupDescription = 'No answer'
        } else if (hangupCause === 'call_rejected') {
          outcome = 'declined'
          hangupDescription = 'Call was declined'
        } else if (hangupCause === 'originator_cancel') {
          outcome = 'cancelled'
          hangupDescription = 'Call cancelled'
        }

        await logCheckpoint(serviceClient, callId, 'call_ended', { hangupCause, outcome })

        await serviceClient
          .from('calls')
          .update({
            status: 'ended',
            ended_at: endedAt.toISOString(),
            outcome,
            duration_seconds: durationSeconds,
          })
          .eq('id', callId)

        await logCallEvent(serviceClient, callId, 'status_change', hangupDescription, {
          status: 'ended',
          outcome,
          hangup_cause: hangupCause,
          duration_seconds: durationSeconds
        })

        await serviceClient
          .from('call_contexts')
          .update({ status: 'completed' })
          .eq('call_id', callId)
        break
      }

      case 'call.transcription': {
        const transcription = event.payload.transcription_data

        // ============================================================
        // CRITICAL DIAGNOSTIC: Log FULL transcription event payload
        // This will tell us exactly what leg values Telnyx is sending
        // ============================================================
        console.log('[webhook] ========== TRANSCRIPTION EVENT ==========')
        console.log('[webhook] FULL payload:', JSON.stringify(event.payload, null, 2))
        console.log('[webhook] Key fields:')
        console.log('[webhook]   - leg:', event.payload.leg)
        console.log('[webhook]   - transcript:', transcription?.transcript)
        console.log('[webhook]   - is_final:', transcription?.is_final)
        console.log('[webhook]   - confidence:', transcription?.confidence)
        console.log('[webhook]   - call_control_id:', event.payload.call_control_id)

        // Update audio health tracking - count received transcripts per leg
        try {
          const { data: healthData } = await serviceClient
            .from('calls')
            .select('inbound_audio_health')
            .eq('id', callId)
            .single()

          const health = healthData?.inbound_audio_health || {
            transcription_started: false,
            self_transcripts_received: 0,
            remote_transcripts_received: 0,
          }

          const legValue = event.payload.leg
          const isRemote = legValue !== 'self'

          if (isRemote) {
            health.remote_transcripts_received = (health.remote_transcripts_received || 0) + 1
            health.last_remote_transcript_at = new Date().toISOString()
            health.last_remote_leg_value = legValue  // Track what value Telnyx sends
            console.log('[webhook] 🎤 REMOTE AUDIO RECEIVED! leg value:', legValue)
          } else {
            health.self_transcripts_received = (health.self_transcripts_received || 0) + 1
            health.last_self_transcript_at = new Date().toISOString()
            console.log('[webhook] 🔊 Self audio received (our TTS)')
          }

          await serviceClient.from('calls').update({
            inbound_audio_health: health
          }).eq('id', callId)
        } catch (healthErr) {
          console.error('[webhook] Failed to update audio health:', healthErr)
        }

        if (transcription?.transcript && transcription.transcript.trim().length > 0) {
          const isOurAI = event.payload.leg === 'self'
          const speaker = isOurAI ? 'agent' : 'remote'

          console.log('[webhook] Processing transcription:', {
            speaker,
            isOurAI,
            leg: event.payload.leg,
            is_final: transcription.is_final,
            text: transcription.transcript.substring(0, 50)
          })

          // Log checkpoint for first ASR
          if (!isOurAI) {
            const { data: call } = await serviceClient
              .from('calls')
              .select('pipeline_checkpoints')
              .eq('id', callId)
              .single()

            const checkpoints = call?.pipeline_checkpoints || {}
            if (!checkpoints['first_asr_partial'] && transcription.is_final === false) {
              await logCheckpoint(serviceClient, callId, 'first_asr_partial')
            } else if (!checkpoints['first_asr_final'] && transcription.is_final !== false) {
              await logCheckpoint(serviceClient, callId, 'first_asr_final')
              // Also log first audio received
              if (!checkpoints['first_audio_received']) {
                await logCheckpoint(serviceClient, callId, 'first_audio_received')
              }
            }
          }

          // Only store final transcriptions
          if (transcription.is_final !== false) {
            await serviceClient.from('transcriptions').insert({
              call_id: callId,
              speaker,
              content: transcription.transcript,
              confidence: transcription.confidence || null,
            })
          }

          // If REMOTE party spoke (not our AI) and it's a final transcription
          const isFinal = transcription.is_final === true || transcription.is_final === undefined

          if (!isOurAI && isFinal) {
            const transcriptText = transcription.transcript

            // Clear silence watchdog - we got a response
            await serviceClient.from('calls').update({
              silence_started_at: null,
              last_activity_at: new Date().toISOString()
            }).eq('id', callId)

            // Get the current call state
            const { data: callData } = await serviceClient
              .from('calls')
              .select('closing_state, closing_started_at, telnyx_call_id')
              .eq('id', callId)
              .single()

            const isClosing = callData?.closing_state === 'closing_said'

            console.log('[webhook] Call state:', { isClosing, transcriptText })

            if (isClosing && telnyxApiKey && callData?.telnyx_call_id) {
              // In closing mode - check for farewell or continuation

              if (isContinuation(transcriptText)) {
                console.log('[webhook] Continuation detected, aborting closing')
                await serviceClient
                  .from('calls')
                  .update({ closing_state: 'active', closing_started_at: null })
                  .eq('id', callId)

                await logCallEvent(serviceClient, callId, 'closing_aborted', 'User has more to say', {})
                await triggerVoiceAgent(supabaseUrl, serviceRoleKey, callId, transcriptText, false, false)

              } else if (isFarewell(transcriptText)) {
                console.log('[webhook] Farewell detected, hanging up')
                await logCallEvent(serviceClient, callId, 'mutual_goodbye', 'Mutual goodbye detected', {
                  user_farewell: transcriptText
                })

                await delay(1000) // Grace period
                await hangupCall(callData.telnyx_call_id, telnyxApiKey, serviceClient, callId, 'MUTUAL_GOODBYE')

              } else {
                console.log('[webhook] Ambiguous response in closing mode')
                await triggerVoiceAgent(supabaseUrl, serviceRoleKey, callId, transcriptText, false, false)
              }

            } else {
              // Normal conversation mode
              console.log('[webhook] Remote party spoke, triggering voice agent response')
              await triggerVoiceAgent(supabaseUrl, serviceRoleKey, callId, transcriptText, false, false)

              // Start silence watchdog for next response
              await startSilenceWatchdog(serviceClient, callId)
            }

          } else if (isOurAI) {
            console.log('[webhook] AI agent spoke, not triggering response')
          }
        }
        break
      }

      case 'call.machine.detection.ended': {
        const result = event.payload.result
        console.log('AMD result:', result)

        await serviceClient
          .from('calls')
          .update({ amd_result: result })
          .eq('id', callId)

        if (result === 'machine') {
          await logCallEvent(serviceClient, callId, 'status_change', 'Reached voicemail', { amd_result: result })

          if (telnyxApiKey) {
            await fetch(
              `https://api.telnyx.com/v2/calls/${event.payload.call_control_id}/actions/hangup`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${telnyxApiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
              }
            )
          }
        } else if (result === 'human') {
          await logCallEvent(serviceClient, callId, 'status_change', 'Person answered', { amd_result: result })
        }
        break
      }

      case 'call.dtmf.received':
        console.log('DTMF received:', event.payload.digit)
        await logCallEvent(serviceClient, callId, 'dtmf_received', `Received tone: ${event.payload.digit}`, {
          digit: event.payload.digit
        })
        break

      case 'streaming.started':
        console.log('[webhook] Streaming started for call:', callId)
        await logCallEvent(serviceClient, callId, 'streaming', 'Audio streaming connected', {})
        break

      case 'streaming.failed': {
        console.error('[webhook] Streaming FAILED for call:', callId)
        await logCallEvent(serviceClient, callId, 'error', 'Audio streaming failed', {
          failure_reason: event.payload?.failure_reason || 'unknown'
        })

        // Fallback to legacy mode
        if (telnyxApiKey) {
          await startTranscription(event.payload.call_control_id, telnyxApiKey, callId, serviceClient)
          await triggerVoiceAgent(supabaseUrl, serviceRoleKey, callId, undefined, true, false)
        }
        break
      }

      case 'streaming.stopped':
        console.log('[webhook] Streaming stopped for call:', callId)
        break

      case 'call.speak.started':
        console.log('[webhook] TTS started for call:', callId)
        break

      case 'call.speak.ended': {
        console.log('[webhook] TTS ended for call:', callId)

        // TTS finished - start silence watchdog to detect if callee doesn't respond
        await startSilenceWatchdog(serviceClient, callId)

        // Check closing timeout
        const { data: speakEndCallData } = await serviceClient
          .from('calls')
          .select('closing_state, closing_started_at, telnyx_call_id')
          .eq('id', callId)
          .single()

        if (speakEndCallData?.closing_state === 'closing_said' && speakEndCallData?.closing_started_at) {
          const closingStarted = new Date(speakEndCallData.closing_started_at)
          const now = new Date()
          const secondsSinceClosing = (now.getTime() - closingStarted.getTime()) / 1000

          console.log('[webhook] In closing state, seconds since closing:', secondsSinceClosing)

          if (secondsSinceClosing > 10 && telnyxApiKey && speakEndCallData.telnyx_call_id) {
            console.log('[webhook] Silence timeout reached, hanging up')
            await hangupCall(
              speakEndCallData.telnyx_call_id,
              telnyxApiKey,
              serviceClient,
              callId,
              'SILENCE_TIMEOUT_AFTER_CLOSING'
            )
          }
        }
        break
      }

      default:
        console.log('Unhandled event type:', eventType)
    }

    // Check silence watchdog on every event
    if (callId && telnyxApiKey && supabaseUrl && serviceRoleKey) {
      await checkSilenceWatchdog(serviceClient, callId, supabaseUrl, serviceRoleKey, telnyxApiKey)
    }

    // Also check closing timeout
    if (callId && telnyxApiKey) {
      const { data: timeoutCheckCall } = await serviceClient
        .from('calls')
        .select('closing_state, closing_started_at, telnyx_call_id, status')
        .eq('id', callId)
        .single()

      if (
        timeoutCheckCall?.status === 'answered' &&
        timeoutCheckCall?.closing_state === 'closing_said' &&
        timeoutCheckCall?.closing_started_at &&
        timeoutCheckCall?.telnyx_call_id
      ) {
        const closingStarted = new Date(timeoutCheckCall.closing_started_at)
        const now = new Date()
        const secondsSinceClosing = (now.getTime() - closingStarted.getTime()) / 1000

        if (secondsSinceClosing > 10) {
          console.log('[webhook] Closing timeout check: hanging up after', secondsSinceClosing, 'seconds')
          await hangupCall(
            timeoutCheckCall.telnyx_call_id,
            telnyxApiKey,
            serviceClient,
            callId,
            'SILENCE_TIMEOUT_AFTER_CLOSING'
          )
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Webhook error:', error)
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

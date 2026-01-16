import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

// Helper to log call events for live status updates
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

    // Log the DTMF event
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

// Farewell phrases - high confidence (auto-hangup when in closing_said state)
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

// Check if text contains a farewell
function isFarewell(text: string): boolean {
  const lower = text.toLowerCase().trim()
  // Check for farewell phrases
  for (const phrase of FAREWELL_PHRASES) {
    if (lower.includes(phrase)) {
      return true
    }
  }
  return false
}

// Check if text contains continuation markers
function isContinuation(text: string): boolean {
  const lower = text.toLowerCase().trim()
  // Check for continuation markers
  for (const marker of CONTINUATION_MARKERS) {
    if (lower.includes(marker)) {
      return true
    }
  }
  // Also check for question marks (likely asking something new)
  if (lower.includes('?')) {
    return true
  }
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
  isOpening = false
) {
  const url = `${supabaseUrl}/functions/v1/voice-agent`
  console.log('[webhook] triggerVoiceAgent: Calling', url)
  console.log('[webhook] triggerVoiceAgent: call_id:', callId, 'isOpening:', isOpening)

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
      }),
    })

    const responseText = await response.text()
    console.log('[webhook] triggerVoiceAgent: Response status:', response.status)
    console.log('[webhook] triggerVoiceAgent: Response body:', responseText.substring(0, 500))

    if (!response.ok) {
      console.error('[webhook] triggerVoiceAgent: FAILED with status', response.status)
      throw new Error(`Voice agent returned ${response.status}: ${responseText}`)
    }

    console.log('[webhook] triggerVoiceAgent: SUCCESS')
    return JSON.parse(responseText)
  } catch (error) {
    console.error('[webhook] triggerVoiceAgent: ERROR:', error)
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

    const response = await fetch(
      `https://api.telnyx.com/v2/calls/${callControlId}/actions/transcription_start`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${telnyxApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          language: 'en',
          transcription_tracks: 'both', // Transcribe both sides of the conversation
        }),
      }
    )

    const responseText = await response.text()

    if (!response.ok) {
      console.error('[webhook] Failed to start transcription:', responseText)
      await logCallEvent(serviceClient, callId, 'error', 'Failed to start transcription', { error: responseText })
    } else {
      console.log('[webhook] Transcription started successfully:', responseText)
      await logCallEvent(serviceClient, callId, 'transcription_started', 'Listening to conversation', {})
    }
  } catch (error) {
    console.error('[webhook] Transcription start error:', error)
  }
}

serve(async (req) => {
  // Log EVERY request to this function
  console.log('[webhook-telnyx] ========== REQUEST RECEIVED ==========')
  console.log('[webhook-telnyx] Method:', req.method)
  console.log('[webhook-telnyx] URL:', req.url)

  if (req.method === 'OPTIONS') {
    console.log('[webhook-telnyx] Responding to OPTIONS preflight')
    return new Response('ok', { headers: corsHeaders })
  }

  // Simple health check for GET requests
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

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

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
        await serviceClient
          .from('calls')
          .update({
            status: 'answered',
            started_at: new Date().toISOString(),
          })
          .eq('id', callId)

        await logCallEvent(serviceClient, callId, 'status_change', 'Call connected', { status: 'answered' })

        // Check if using OpenAI Realtime API bridge
        const audioBridgeUrl = Deno.env.get('AUDIO_BRIDGE_URL')
        const audioRelayUrl = Deno.env.get('AUDIO_RELAY_URL')

        // TEMPORARILY DISABLED: Audio bridge has connectivity issues with Deno Deploy
        // Force legacy mode until we fix the WebSocket connection issue
        const useAudioBridge = false // was: audioBridgeUrl && telnyxApiKey

        if (useAudioBridge && audioBridgeUrl && telnyxApiKey) {
          // Using OpenAI Realtime API - stream audio to bridge
          // Bridge handles: audio conversion, OpenAI communication, transcript capture
          try {
            // Convert https:// to wss:// for WebSocket streaming
            const wssBridgeUrl = audioBridgeUrl.replace(/^https?:\/\//, 'wss://')
            const streamUrl = `${wssBridgeUrl}/telnyx-stream?call_id=${callId}`

            // Notify bridge to prepare session
            await fetch(`${audioBridgeUrl}/start-session`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ call_id: callId })
            })

            // Start Telnyx media streaming to bridge
            // Using JSON WebSocket format (not RTP) for bidirectional audio
            const streamResponse = await fetch(
              `https://api.telnyx.com/v2/calls/${event.payload.call_control_id}/actions/streaming_start`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${telnyxApiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  stream_url: streamUrl,
                  stream_track: 'both_tracks',
                }),
              }
            )

            const streamResult = await streamResponse.text()
            console.log(`[webhook] Telnyx streaming_start response:`, streamResult)
            console.log(`[webhook] Started Realtime API streaming for call ${callId} to ${streamUrl}`)
            await logCallEvent(serviceClient, callId, 'realtime_api', 'Voice AI connected via Realtime API', { bridge_url: audioBridgeUrl, stream_url: streamUrl })

            // DON'T start Telnyx transcription - OpenAI Realtime handles it
            // DON'T trigger voice-agent - OpenAI Realtime handles responses

          } catch (bridgeError) {
            console.error('[webhook] Failed to start Realtime API bridge:', bridgeError)
            await logCallEvent(serviceClient, callId, 'error', 'Failed to connect Voice AI', { error: String(bridgeError) })

            // Fallback to legacy voice agent
            if (telnyxApiKey && callId) {
              await startTranscription(event.payload.call_control_id, telnyxApiKey, callId, serviceClient)
            }
          }
        } else {
          // Legacy mode: Telnyx transcription + voice-agent function
          console.log('[webhook] ========== CALL ANSWERED - LEGACY MODE ==========')
          console.log('[webhook] call_id:', callId)
          console.log('[webhook] call_control_id:', event.payload.call_control_id)

          if (telnyxApiKey && callId) {
            console.log('[webhook] Starting transcription...')
            await startTranscription(event.payload.call_control_id, telnyxApiKey, callId, serviceClient)
            console.log('[webhook] Transcription start command sent')
          } else {
            console.error('[webhook] Cannot start transcription - missing telnyxApiKey or callId')
          }

          // Trigger voice agent opening greeting immediately
          const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

          console.log('[webhook] Supabase URL:', supabaseUrl ? 'present' : 'MISSING')
          console.log('[webhook] Service role key:', serviceRoleKey ? 'present' : 'MISSING')

          if (!supabaseUrl || !serviceRoleKey) {
            console.error('[webhook] ERROR: Cannot trigger voice agent - missing credentials!')
          } else {
            console.log('[webhook] Triggering voice agent opening greeting for call:', callId)
            try {
              await triggerVoiceAgent(supabaseUrl, serviceRoleKey, callId, undefined, true)
              console.log('[webhook] Voice agent trigger completed successfully')
            } catch (voiceErr) {
              console.error('[webhook] Voice agent trigger FAILED:', voiceErr)
            }
          }

          // Start media streaming for Listen In feature (legacy audio relay)
          if (audioRelayUrl && telnyxApiKey) {
            try {
              const streamUrl = `${audioRelayUrl}?call_id=${callId}&type=telnyx`
              await fetch(
                `https://api.telnyx.com/v2/calls/${event.payload.call_control_id}/actions/streaming_start`,
                {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${telnyxApiKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    stream_url: streamUrl,
                    stream_track: 'both_tracks',
                  }),
                }
              )
              console.log(`Started streaming for call ${callId} to ${streamUrl}`)
            } catch (streamError) {
              console.error('Failed to start streaming:', streamError)
            }
          }
        }

        // Check for IVR path and auto-navigate
        if (telnyxApiKey) {
          // Get call context with IVR path
          const { data: context } = await serviceClient
            .from('call_contexts')
            .select('id, ivr_path_id, gathered_info, status')
            .eq('call_id', callId)
            .maybeSingle() as { data: CallContext | null }

          if (context?.ivr_path_id) {
            // Get the IVR path
            const { data: ivrPath } = await serviceClient
              .from('ivr_paths')
              .select('id, company_name, department, menu_path')
              .eq('id', context.ivr_path_id)
              .single() as { data: IvrPath | null }

            if (ivrPath?.menu_path && Array.isArray(ivrPath.menu_path)) {
              console.log(`Starting IVR navigation for ${ivrPath.company_name} - ${ivrPath.department}`)

              await logCallEvent(serviceClient, callId, 'ivr_navigation', `Navigating ${ivrPath.company_name} phone menu`, {
                company: ivrPath.company_name,
                department: ivrPath.department
              })

              // Update context status
              await serviceClient
                .from('call_contexts')
                .update({ status: 'in_call' })
                .eq('id', context.id)

              // Navigate IVR menu steps with delays
              for (const step of ivrPath.menu_path) {
                // Wait for IVR prompt to play
                await delay(3000)

                let digits = step.action

                // Check if action requires dynamic input from gathered info
                if (step.action.includes('_')) {
                  // Action like "account_number" means use gathered info
                  const infoKey = step.action
                  if (context.gathered_info && context.gathered_info[infoKey]) {
                    digits = context.gathered_info[infoKey]
                    await logCallEvent(serviceClient, callId, 'ivr_navigation', `Entering ${infoKey.replace(/_/g, ' ')}`, { step: step.step })
                  } else {
                    console.log(`Missing gathered info for: ${infoKey}, skipping step`)
                    await logCallEvent(serviceClient, callId, 'ivr_navigation', `Waiting - need ${infoKey.replace(/_/g, ' ')}`, { step: step.step, missing: infoKey })
                    continue
                  }
                } else {
                  await logCallEvent(serviceClient, callId, 'ivr_navigation', step.note, { step: step.step, digits })
                }

                console.log(`IVR Step ${step.step}: ${step.note} - sending ${digits}`)
                await sendDtmf(event.payload.call_control_id, digits, telnyxApiKey, serviceClient, callId)
              }

              await logCallEvent(serviceClient, callId, 'ivr_navigation', 'Menu navigation complete, connecting to representative...', {})
              console.log('IVR navigation complete')
            }
          }
        }
        break

      case 'call.hangup': {
        // Get the call to calculate duration
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

        // Determine outcome based on hangup cause and AMD result
        const hangupCause = event.payload?.hangup_cause || 'normal'
        let outcome = 'completed'
        let hangupDescription = 'Call ended'

        if (hangupCause === 'normal_clearing' || hangupCause === 'normal') {
          // Check if it was a voicemail based on stored AMD result
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

        // Update call context status
        await serviceClient
          .from('call_contexts')
          .update({ status: 'completed' })
          .eq('call_id', callId)
        break
      }

      case 'call.transcription': {
        // Handle real-time transcription from Telnyx
        const transcription = event.payload.transcription_data

        // Log full transcription payload for debugging
        console.log('[webhook] Transcription event received:', JSON.stringify({
          leg: event.payload.leg,
          transcript: transcription?.transcript,
          is_final: transcription?.is_final,
          confidence: transcription?.confidence,
          full_payload: event.payload
        }))

        if (transcription?.transcript && transcription.transcript.trim().length > 0) {
          // Determine speaker based on leg
          // For OUTBOUND calls (we're calling them):
          // - 'self' = our side (AI agent speaking)
          // - anything else = the person we called (remote party)
          const isOurAI = event.payload.leg === 'self'
          const speaker = isOurAI ? 'agent' : 'remote'

          console.log('[webhook] Processing transcription:', {
            speaker,
            isOurAI,
            leg: event.payload.leg,
            is_final: transcription.is_final,
            text: transcription.transcript.substring(0, 50)
          })

          // Only store final transcriptions to avoid duplicates
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

            // Get the current call state to check if we're in closing mode
            const { data: callData } = await serviceClient
              .from('calls')
              .select('closing_state, closing_started_at, telnyx_call_id')
              .eq('id', callId)
              .single()

            const isClosing = callData?.closing_state === 'closing_said'
            const closingStartedAt = callData?.closing_started_at ? new Date(callData.closing_started_at) : null

            console.log('[webhook] Call state:', {
              isClosing,
              closingStartedAt: closingStartedAt?.toISOString(),
              transcriptText
            })

            if (isClosing && telnyxApiKey && callData?.telnyx_call_id) {
              // We're in closing mode - check for farewell or continuation

              if (isContinuation(transcriptText)) {
                // User wants to continue - abort closing, return to active
                console.log('[webhook] Continuation detected, aborting closing')
                await serviceClient
                  .from('calls')
                  .update({ closing_state: 'active', closing_started_at: null })
                  .eq('id', callId)

                await logCallEvent(serviceClient, callId, 'closing_aborted', 'User has more to say, continuing call', {})

                // Trigger voice agent to respond
                const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
                const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
                await triggerVoiceAgent(supabaseUrl, serviceRoleKey, callId, transcriptText, false)

              } else if (isFarewell(transcriptText)) {
                // User said goodbye - hang up after short grace period
                console.log('[webhook] Farewell detected, hanging up after grace period')
                await logCallEvent(serviceClient, callId, 'mutual_goodbye', 'Mutual goodbye detected', {
                  user_farewell: transcriptText
                })

                // Wait 1 second grace period to let their last word finish
                await delay(1000)
                await hangupCall(callData.telnyx_call_id, telnyxApiKey, serviceClient, callId, 'MUTUAL_GOODBYE')

              } else {
                // Not a clear farewell or continuation - respond but stay in closing
                console.log('[webhook] Ambiguous response in closing mode, responding but staying in closing')

                const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
                const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
                await triggerVoiceAgent(supabaseUrl, serviceRoleKey, callId, transcriptText, false)
              }

            } else {
              // Normal conversation mode - trigger voice agent
              console.log('[webhook] Remote party spoke, triggering voice agent response')
              console.log('[webhook] Their words:', transcriptText)

              const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
              const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
              await triggerVoiceAgent(supabaseUrl, serviceRoleKey, callId, transcriptText, false)
            }

          } else if (isOurAI) {
            console.log('[webhook] AI agent spoke, not triggering response (avoiding loop)')
          }
        }
        break
      }

      case 'call.machine.detection.ended': {
        // Handle answering machine detection
        const result = event.payload.result
        console.log('AMD result:', result)

        // Store AMD result in the call record
        await serviceClient
          .from('calls')
          .update({ amd_result: result })
          .eq('id', callId)

        // Check if using Realtime API bridge
        const usingRealtimeBridgeForAmd = !!Deno.env.get('AUDIO_BRIDGE_URL')

        if (result === 'machine') {
          await logCallEvent(serviceClient, callId, 'status_change', 'Reached voicemail', { amd_result: result })

          if (telnyxApiKey) {
            // Optionally hang up on machine
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

          // Only trigger legacy voice-agent if NOT using Realtime API
          // The Realtime API bridge handles the opening greeting automatically
          if (!usingRealtimeBridgeForAmd) {
            const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
            const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
            console.log('[webhook] Human detected, triggering voice agent opening')
            await triggerVoiceAgent(supabaseUrl, serviceRoleKey, callId, undefined, true)
          } else {
            console.log('[webhook] Human detected, Realtime API bridge handles greeting')
          }
        }
        break
      }

      case 'call.dtmf.received':
        // Log DTMF tones received
        console.log('DTMF received:', event.payload.digit)
        await logCallEvent(serviceClient, callId, 'dtmf_received', `Received tone: ${event.payload.digit}`, {
          digit: event.payload.digit
        })
        break

      case 'streaming.started':
        console.log('[webhook] Streaming started successfully for call:', callId)
        await logCallEvent(serviceClient, callId, 'streaming', 'Audio streaming connected', {})
        break

      case 'streaming.failed': {
        // Streaming to audio bridge failed - fall back to legacy voice-agent mode
        console.error('[webhook] Streaming FAILED for call:', callId, 'Falling back to legacy mode')
        console.error('[webhook] Streaming failure details:', JSON.stringify(event.payload))

        await logCallEvent(serviceClient, callId, 'error', 'Audio bridge connection failed, using backup voice mode', {
          failure_reason: event.payload?.failure_reason || 'unknown'
        })

        // Start Telnyx transcription as fallback
        if (telnyxApiKey) {
          await startTranscription(event.payload.call_control_id, telnyxApiKey, callId, serviceClient)

          // Trigger voice agent opening greeting
          const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
          console.log('[webhook] Triggering legacy voice agent as fallback')
          await triggerVoiceAgent(supabaseUrl, serviceRoleKey, callId, undefined, true)
        }
        break
      }

      case 'streaming.stopped':
        console.log('[webhook] Streaming stopped for call:', callId)
        break

      case 'call.speak.ended': {
        // TTS finished speaking - good time to check for timeout if in closing state
        console.log('[webhook] Speak ended for call:', callId)

        // Get call state
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

          // If we've been in closing state for more than 10 seconds, start silence timer
          // (The actual hangup will happen on timeout, not here - this is just logging)
          if (secondsSinceClosing > 10 && telnyxApiKey && speakEndCallData.telnyx_call_id) {
            console.log('[webhook] Silence timeout reached (10s), hanging up')
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

    // After handling the event, check for closing timeout on any event
    // This ensures we catch silence timeouts even if no specific event triggers it
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

        // 10 second silence timeout
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
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

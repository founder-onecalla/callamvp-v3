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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const event = body.data
    const eventType = event.event_type

    console.log('Telnyx webhook received:', eventType)

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

        // Start media streaming for Listen In feature
        const audioRelayUrl = Deno.env.get('AUDIO_RELAY_URL')

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

      case 'call.hangup':
        await serviceClient
          .from('calls')
          .update({
            status: 'ended',
            ended_at: new Date().toISOString(),
          })
          .eq('id', callId)

        // Get hangup reason for better description
        const hangupCause = event.payload?.hangup_cause || 'normal'
        let hangupDescription = 'Call ended'
        if (hangupCause === 'normal_clearing') {
          hangupDescription = 'Call ended'
        } else if (hangupCause === 'busy') {
          hangupDescription = 'Line was busy'
        } else if (hangupCause === 'no_answer') {
          hangupDescription = 'No answer'
        } else if (hangupCause === 'call_rejected') {
          hangupDescription = 'Call was declined'
        }

        await logCallEvent(serviceClient, callId, 'status_change', hangupDescription, {
          status: 'ended',
          hangup_cause: hangupCause
        })

        // Update call context status
        await serviceClient
          .from('call_contexts')
          .update({ status: 'completed' })
          .eq('call_id', callId)
        break

      case 'call.transcription':
        // Handle real-time transcription
        const transcription = event.payload.transcription_data
        if (transcription?.transcript) {
          // Determine speaker based on leg
          const speaker = event.payload.leg === 'self' ? 'user' : 'remote'

          await serviceClient.from('transcriptions').insert({
            call_id: callId,
            speaker,
            content: transcription.transcript,
            confidence: transcription.confidence || null,
          })

          // Also log as event for live feed
          await logCallEvent(serviceClient, callId, 'transcription', transcription.transcript, {
            speaker,
            confidence: transcription.confidence
          })
        }
        break

      case 'call.machine.detection.ended':
        // Handle answering machine detection
        const result = event.payload.result
        console.log('AMD result:', result)

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
        }
        break

      case 'call.dtmf.received':
        // Log DTMF tones received
        console.log('DTMF received:', event.payload.digit)
        await logCallEvent(serviceClient, callId, 'dtmf_received', `Received tone: ${event.payload.digit}`, {
          digit: event.payload.digit
        })
        break

      default:
        console.log('Unhandled event type:', eventType)
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

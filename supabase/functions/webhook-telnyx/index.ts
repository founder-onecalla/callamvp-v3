import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    switch (eventType) {
      case 'call.initiated':
        await serviceClient
          .from('calls')
          .update({
            status: 'ringing',
            telnyx_call_id: event.payload.call_control_id,
          })
          .eq('id', callId)
        break

      case 'call.answered':
        await serviceClient
          .from('calls')
          .update({
            status: 'answered',
            started_at: new Date().toISOString(),
          })
          .eq('id', callId)
        break

      case 'call.hangup':
        await serviceClient
          .from('calls')
          .update({
            status: 'ended',
            ended_at: new Date().toISOString(),
          })
          .eq('id', callId)
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
        }
        break

      case 'call.machine.detection.ended':
        // Handle answering machine detection
        const result = event.payload.result
        console.log('AMD result:', result)

        if (result === 'machine') {
          // Optionally hang up on machine
          const telnyxApiKey = Deno.env.get('TELNYX_API_KEY')
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
        }
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

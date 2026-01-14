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
    console.log('call-start: Starting...')

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Missing authorization header')
    }
    console.log('call-start: Auth header present')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      console.error('call-start: Auth error', authError)
      throw new Error('Unauthorized')
    }
    console.log('call-start: User authenticated', user.id)

    const { phone_number, context_id } = await req.json()
    if (!phone_number) {
      throw new Error('Phone number is required')
    }
    console.log('call-start: Phone number', phone_number, 'context_id:', context_id || 'none')

    // Format phone number (basic cleanup)
    let formattedNumber = phone_number.replace(/[^\d+]/g, '')
    if (!formattedNumber.startsWith('+')) {
      formattedNumber = '+1' + formattedNumber // Assume US if no country code
    }

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Create call record in DB
    const { data: call, error: insertError } = await serviceClient
      .from('calls')
      .insert({
        user_id: user.id,
        phone_number: formattedNumber,
        status: 'pending',
        direction: 'outbound',
      })
      .select()
      .single()

    if (insertError) {
      console.error('call-start: DB insert error', insertError)
      throw new Error(`Failed to create call record: ${insertError.message}`)
    }
    console.log('call-start: Call record created', call.id)

    // Link call context to this call if context_id provided
    if (context_id) {
      await serviceClient
        .from('call_contexts')
        .update({
          call_id: call.id,
          status: 'ready'
        })
        .eq('id', context_id)
        .eq('user_id', user.id)
      console.log('call-start: Linked call context', context_id)
    }

    // Get Telnyx credentials
    const telnyxApiKey = Deno.env.get('TELNYX_API_KEY')
    const telnyxConnectionId = Deno.env.get('TELNYX_CONNECTION_ID')
    const telnyxFromNumber = Deno.env.get('TELNYX_PHONE_NUMBER')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const audioRelayUrl = Deno.env.get('AUDIO_RELAY_URL') // e.g., wss://your-relay.deno.dev

    if (!telnyxApiKey || !telnyxConnectionId || !telnyxFromNumber) {
      console.error('call-start: Missing Telnyx credentials', {
        hasApiKey: !!telnyxApiKey,
        hasConnectionId: !!telnyxConnectionId,
        hasFromNumber: !!telnyxFromNumber
      })
      throw new Error('Telnyx credentials not configured')
    }
    console.log('call-start: Telnyx credentials present, initiating call...')

    // Initiate Telnyx call
    const telnyxResponse = await fetch('https://api.telnyx.com/v2/calls', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${telnyxApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        connection_id: telnyxConnectionId,
        to: formattedNumber,
        from: telnyxFromNumber,
        webhook_url: `${supabaseUrl}/functions/v1/webhook-telnyx`,
        webhook_url_method: 'POST',
        answering_machine_detection: 'detect',
        client_state: btoa(JSON.stringify({ call_id: call.id, user_id: user.id })),
        transcription: {
          transcription_engine: 'B',
          transcription_tracks: 'both',
        },
      }),
    })

    if (!telnyxResponse.ok) {
      const error = await telnyxResponse.text()
      // Update call status to ended if Telnyx fails
      await serviceClient
        .from('calls')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('id', call.id)
      throw new Error(`Telnyx API error: ${error}`)
    }

    const telnyxData = await telnyxResponse.json()
    const telnyxCallId = telnyxData.data.call_control_id

    // Update call with Telnyx call ID
    await serviceClient
      .from('calls')
      .update({ telnyx_call_id: telnyxCallId })
      .eq('id', call.id)

    return new Response(JSON.stringify({
      call: { ...call, telnyx_call_id: telnyxCallId }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('call-start error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

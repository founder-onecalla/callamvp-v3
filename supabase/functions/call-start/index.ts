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
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Missing authorization header')
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      throw new Error('Unauthorized')
    }

    const { phone_number } = await req.json()
    if (!phone_number) {
      throw new Error('Phone number is required')
    }

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
      throw new Error(`Failed to create call record: ${insertError.message}`)
    }

    // Get Telnyx credentials
    const telnyxApiKey = Deno.env.get('TELNYX_API_KEY')
    const telnyxConnectionId = Deno.env.get('TELNYX_CONNECTION_ID')
    const telnyxFromNumber = Deno.env.get('TELNYX_PHONE_NUMBER')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')

    if (!telnyxApiKey || !telnyxConnectionId || !telnyxFromNumber) {
      throw new Error('Telnyx credentials not configured')
    }

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
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

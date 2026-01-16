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

    const { phone_number, context_id, purpose } = await req.json()
    if (!phone_number) {
      throw new Error('Phone number is required')
    }
    console.log('call-start: Phone number', phone_number, 'context_id:', context_id || 'none', 'purpose:', purpose || 'none')

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
    // Or create one from purpose if no context_id
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
    } else if (purpose) {
      // Create a call context from the purpose so voice-agent knows what to do
      const { data: newContext, error: contextError } = await serviceClient
        .from('call_contexts')
        .insert({
          user_id: user.id,
          call_id: call.id,
          intent_category: 'personal',
          intent_purpose: purpose,
          gathered_info: {},
          status: 'ready'
        })
        .select()
        .single()

      if (contextError) {
        console.error('call-start: Failed to create call context', contextError)
      } else {
        console.log('call-start: Created call context from purpose', newContext.id)
      }
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
    // IMPORTANT: webhook_url must be publicly accessible and the Telnyx Connection must allow per-call webhooks
    const webhookUrl = `${supabaseUrl}/functions/v1/webhook-telnyx`
    console.log('call-start: ========== INITIATING TELNYX CALL ==========')
    console.log('call-start: WEBHOOK URL:', webhookUrl)
    console.log('call-start: CONNECTION_ID:', telnyxConnectionId)
    console.log('call-start: FROM:', telnyxFromNumber)
    console.log('call-start: TO:', formattedNumber)

    // Format FROM number if needed (in case secret is stored without +)
    let formattedFrom = telnyxFromNumber
    if (!formattedFrom.startsWith('+')) {
      formattedFrom = '+' + formattedFrom.replace(/[^\d]/g, '')
      console.log('call-start: Reformatted FROM number to:', formattedFrom)
    }
    
    // Validate TO number (should already be formatted above)
    if (!formattedNumber.startsWith('+')) {
      console.error('call-start: Invalid TO number format - must start with +')
      throw new Error('Invalid destination phone number format')
    }

    const telnyxPayload = {
      connection_id: telnyxConnectionId,
      to: formattedNumber,
      from: formattedFrom,
      webhook_url: webhookUrl,
      webhook_url_method: 'POST',
      client_state: btoa(JSON.stringify({ call_id: call.id, user_id: user.id })),
    }
    
    console.log('call-start: Telnyx request payload:', JSON.stringify(telnyxPayload, null, 2))

    let telnyxResponse
    try {
      telnyxResponse = await fetch('https://api.telnyx.com/v2/calls', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${telnyxApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(telnyxPayload),
      })
    } catch (fetchError) {
      console.error('call-start: Telnyx fetch failed:', fetchError)
      console.error('call-start: Fetch error details:', {
        name: fetchError.name,
        message: fetchError.message,
        cause: fetchError.cause
      })
      await serviceClient
        .from('calls')
        .update({ 
          status: 'ended', 
          ended_at: new Date().toISOString(), 
          outcome: 'failed',
          pipeline_checkpoints: { error: 'telnyx_fetch_failed', details: fetchError.message }
        })
        .eq('id', call.id)
      throw new Error('Failed to connect to Telnyx')
    }

    console.log('call-start: Telnyx response status:', telnyxResponse.status)
    console.log('call-start: Telnyx response headers:', Object.fromEntries(telnyxResponse.headers.entries()))

    if (!telnyxResponse.ok) {
      const errorText = await telnyxResponse.text()
      console.error('call-start: ❌ TELNYX API ERROR')
      console.error('call-start: Status:', telnyxResponse.status)
      console.error('call-start: Response:', errorText)
      
      // Parse error details if possible
      let errorDetails = errorText
      try {
        const errorJson = JSON.parse(errorText)
        errorDetails = JSON.stringify(errorJson, null, 2)
        console.error('call-start: Parsed error:', errorJson)
      } catch {
        // Keep raw text
      }
      
      // Update call status to ended if Telnyx fails
      await serviceClient
        .from('calls')
        .update({ 
          status: 'ended', 
          ended_at: new Date().toISOString(), 
          outcome: 'failed',
          pipeline_checkpoints: { 
            error: 'telnyx_api_error', 
            status: telnyxResponse.status,
            details: errorDetails.substring(0, 500)
          }
        })
        .eq('id', call.id)
      
      // Provide user-friendly error messages
      if (telnyxResponse.status === 401 || telnyxResponse.status === 403) {
        throw new Error('Phone service authentication failed. Please contact support.')
      } else if (telnyxResponse.status === 400) {
        throw new Error('Invalid call request. Please check the phone number.')
      } else if (telnyxResponse.status === 402) {
        throw new Error('Phone service billing issue. Please contact support.')
      } else if (telnyxResponse.status === 422) {
        throw new Error('Invalid phone number or configuration. Please try again.')
      } else {
        throw new Error(`Phone service error (${telnyxResponse.status}). Please try again.`)
      }
    }

    const telnyxData = await telnyxResponse.json()
    console.log('call-start: Telnyx response data:', JSON.stringify(telnyxData))
    const telnyxCallId = telnyxData.data?.call_control_id

    if (!telnyxCallId) {
      console.error('call-start: No call_control_id in Telnyx response')
      throw new Error('Telnyx did not return a call ID')
    }

    console.log('call-start: Telnyx call initiated, call_control_id:', telnyxCallId)

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

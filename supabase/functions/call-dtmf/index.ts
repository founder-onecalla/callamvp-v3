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

    const { call_id, digits } = await req.json()
    if (!call_id) {
      throw new Error('Call ID is required')
    }
    if (!digits) {
      throw new Error('Digits are required')
    }

    // Validate DTMF digits
    const validDtmf = /^[0-9*#]+$/
    if (!validDtmf.test(digits)) {
      throw new Error('Invalid DTMF digits. Use 0-9, *, or #')
    }

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get the call record
    const { data: call, error: fetchError } = await serviceClient
      .from('calls')
      .select('*')
      .eq('id', call_id)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !call) {
      throw new Error('Call not found')
    }

    if (!call.telnyx_call_id) {
      throw new Error('Call has no Telnyx ID')
    }

    if (call.status !== 'answered') {
      throw new Error('Call must be answered to send DTMF')
    }

    const telnyxApiKey = Deno.env.get('TELNYX_API_KEY')
    if (!telnyxApiKey) {
      throw new Error('Telnyx API key not configured')
    }

    // Send DTMF to Telnyx
    const telnyxResponse = await fetch(
      `https://api.telnyx.com/v2/calls/${call.telnyx_call_id}/actions/send_dtmf`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${telnyxApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          digits,
          duration_millis: 250,
        }),
      }
    )

    if (!telnyxResponse.ok) {
      const error = await telnyxResponse.text()
      throw new Error(`Telnyx DTMF error: ${error}`)
    }

    return new Response(JSON.stringify({ success: true, digits }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

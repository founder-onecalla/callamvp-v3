import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const functions = [
  {
    name: "place_call",
    description: "Place an outbound phone call to a given number",
    parameters: {
      type: "object",
      properties: {
        phone_number: {
          type: "string",
          description: "The phone number to call (E.164 format preferred, e.g., +15551234567)"
        },
        purpose: {
          type: "string",
          description: "The purpose or reason for the call"
        }
      },
      required: ["phone_number"]
    }
  },
  {
    name: "hang_up_call",
    description: "Hang up the current active call",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "send_dtmf",
    description: "Send DTMF tones (touch tones) during an active call",
    parameters: {
      type: "object",
      properties: {
        digits: {
          type: "string",
          description: "The DTMF digits to send (0-9, *, #)"
        }
      },
      required: ["digits"]
    }
  }
]

const systemPrompt = `You are an AI assistant that helps users place and manage phone calls. You can:
1. Place outbound calls when the user provides a phone number
2. Hang up active calls
3. Send DTMF tones (keypad presses) during calls

When a user wants to call someone, extract the phone number and use the place_call function.
When they want to press buttons or enter numbers during a call, use send_dtmf.
When they want to end the call, use hang_up_call.

Be conversational and helpful. If the user's request is unclear, ask for clarification.`

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

    const { messages, current_call_id } = await req.json()

    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) {
      throw new Error('OpenAI API key not configured')
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4-turbo-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        functions,
        function_call: 'auto',
        temperature: 0.7,
        max_tokens: 500,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI API error: ${error}`)
    }

    const data = await response.json()
    const choice = data.choices[0]

    let result: { message?: string; function_call?: { name: string; arguments: Record<string, unknown> } } = {}

    if (choice.message.function_call) {
      const functionCall = choice.message.function_call
      result.function_call = {
        name: functionCall.name,
        arguments: JSON.parse(functionCall.arguments)
      }
      result.message = choice.message.content || undefined
    } else {
      result.message = choice.message.content
    }

    // Store the messages in the database
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Store user message
    const lastUserMessage = messages[messages.length - 1]
    if (lastUserMessage?.role === 'user') {
      await serviceClient.from('messages').insert({
        user_id: user.id,
        role: 'user',
        content: lastUserMessage.content,
        call_id: current_call_id || null,
      })
    }

    // Store assistant response
    if (result.message) {
      await serviceClient.from('messages').insert({
        user_id: user.id,
        role: 'assistant',
        content: result.message,
        call_id: current_call_id || null,
      })
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

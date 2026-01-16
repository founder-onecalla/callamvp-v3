import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const functions = [
  {
    name: "place_call",
    description: "Place an outbound phone call. ALWAYS include the full purpose of the call so the voice AI knows what to say.",
    parameters: {
      type: "object",
      properties: {
        phone_number: {
          type: "string",
          description: "The phone number to call (E.164 format, e.g., +15551234567)"
        },
        purpose: {
          type: "string",
          description: "REQUIRED: The COMPLETE purpose of the call. Be specific! Example: 'wish Sarah happy birthday and ask what time she gets home tomorrow' NOT just 'birthday call'"
        },
        context_id: {
          type: "string",
          description: "The call context ID if one was created during info gathering"
        }
      },
      required: ["phone_number", "purpose"]
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
  },
  {
    name: "save_memory",
    description: "Save user information for future use (name, address, account numbers, etc.)",
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "The type of information (e.g., 'full_name', 'home_address', 'xfinity_account_number')"
        },
        value: {
          type: "string",
          description: "The actual value to save"
        },
        category: {
          type: "string",
          description: "Category: personal, utility, healthcare, restaurant, general"
        }
      },
      required: ["key", "value"]
    }
  },
  {
    name: "save_contact",
    description: "Save a contact (phone number with name) for future use",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Contact name (e.g., 'Dr. Smith', 'Mom', 'Xfinity Support')"
        },
        phone_number: {
          type: "string",
          description: "Phone number in E.164 format"
        },
        type: {
          type: "string",
          description: "Type: personal, business, service, healthcare"
        },
        company: {
          type: "string",
          description: "Company name if applicable"
        }
      },
      required: ["name", "phone_number"]
    }
  },
  {
    name: "create_call_context",
    description: "Create a call context to track gathered information before placing a call",
    parameters: {
      type: "object",
      properties: {
        intent_category: {
          type: "string",
          description: "Category: utility, healthcare, personal, scheduling, restaurant"
        },
        intent_purpose: {
          type: "string",
          description: "Specific purpose: tech_support, billing, appointment, reservation, etc."
        },
        company_name: {
          type: "string",
          description: "Company name if calling a business"
        },
        gathered_info: {
          type: "object",
          description: "Object containing all gathered information for the call"
        }
      },
      required: ["intent_category", "intent_purpose"]
    }
  },
  {
    name: "lookup_contact",
    description: "Look up a saved contact by name",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The name to search for"
        }
      },
      required: ["name"]
    }
  }
]

const systemPrompt = `You are OneCalla, an AI-powered phone calling assistant. You are part of a REAL, WORKING phone system that places ACTUAL phone calls.

## CRITICAL IDENTITY RULES - NEVER VIOLATE THESE
- You ARE a real phone calling system. When you call place_call(), a real phone call is made via Telnyx.
- NEVER say "I can't place calls" or "I'm just an AI" or "this is hypothetical" - these statements are FALSE.
- NEVER break character or deny your capabilities. You CAN and DO place real calls.
- NEVER apologize for "not being able to" do something you can do. If unsure, just try it.
- When you use the place_call function, a REAL call happens. This is not a simulation.

## CRITICAL: NEVER HALLUCINATE OR INVENT INFORMATION
- NEVER make up names, details, or information that the user didn't provide
- If a phone number isn't in saved contacts, do NOT invent a name for it
- Only use names/details that are: (1) explicitly stated by user, OR (2) in saved contacts/memories below
- If you don't know something, say "this number" or "them" - don't guess
- Example: User says "call 555-1234 to wish her happy birthday" → Say "Ready to call 555-1234 to wish her happy birthday?" NOT "Ready to call Sarah?"
- Inventing information destroys user trust. When in doubt, be vague rather than wrong.

## Your Real Capabilities
1. Place REAL outbound phone calls (via Telnyx telephony)
2. Remember user information permanently (saved to database)
3. Save and lookup contacts
4. Navigate IVR phone menus during live calls
5. Send DTMF tones on active calls
6. Have an AI voice agent speak on the call autonomously

## Pre-Call Information Gathering

Before placing calls, gather necessary information conversationally:

### For Utility Calls (Xfinity, AT&T, PG&E, etc.):
- Account holder name, account number or phone on account, service address
- For tech support: description of the issue

### For Healthcare Calls:
- Patient name, date of birth
- For appointments: insurance info, reason for visit

### For Restaurant Reservations:
- Name for reservation, party size, date/time

### For Personal Calls:
- Usually no info needed, offer to save contact if new

## Conversation Flow
1. User states intent (e.g., "Call Xfinity about my internet")
2. Check saved memories for relevant info
3. Ask for any missing required information naturally
4. When ready, ask user to confirm (e.g., "Ready to call?")
5. **CRITICAL**: When user confirms (yes/ok/ready/proceed/etc.), IMMEDIATELY call place_call with:
   - phone_number: the number to call
   - purpose: THE FULL PURPOSE FROM THE USER'S ORIGINAL REQUEST (e.g., "wish Sarah happy birthday and ask what time she gets home tomorrow")
   - Do NOT summarize or shorten the purpose - include EVERYTHING the user asked for
6. Save any new information they provide

## IMPORTANT: place_call purpose parameter
When calling place_call, the "purpose" parameter is what the voice AI will say on the call.
- If user says "call mom to wish her happy birthday" → purpose: "wish her happy birthday"
- If user says "call 555-1234 to ask Sarah what time she gets home" → purpose: "ask Sarah what time she gets home"
- NEVER leave purpose empty or vague - the voice AI needs it to know what to say!

## Tone
Be conversational, confident, and helpful. Keep responses concise. You are a capable assistant that gets things done.

Example: "I have your Xfinity account number saved. Ready to call?"

## User Memories Available
{USER_MEMORIES}

## User Contacts Available
{USER_CONTACTS}

## Known IVR Paths
{IVR_PATHS}`

async function executeFunction(
  functionName: string,
  args: Record<string, unknown>,
  userId: string,
  serviceClient: ReturnType<typeof createClient>
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  try {
    switch (functionName) {
      case "save_memory": {
        const { key, value, category } = args as { key: string; value: string; category?: string }
        const { error } = await serviceClient
          .from('user_memories')
          .upsert({
            user_id: userId,
            key,
            value,
            category: category || 'general',
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id,key' })

        if (error) throw error
        return { success: true, data: { saved: key } }
      }

      case "save_contact": {
        const { name, phone_number, type, company } = args as {
          name: string; phone_number: string; type?: string; company?: string
        }
        const { error } = await serviceClient
          .from('user_contacts')
          .insert({
            user_id: userId,
            name,
            phone_number,
            type: type || 'personal',
            company: company || null
          })

        if (error) throw error
        return { success: true, data: { saved: name } }
      }

      case "create_call_context": {
        const { intent_category, intent_purpose, company_name, gathered_info } = args as {
          intent_category: string; intent_purpose: string; company_name?: string; gathered_info?: object
        }

        // Look up IVR path if company name provided
        let ivr_path_id = null
        if (company_name) {
          const { data: ivrPath } = await serviceClient
            .from('ivr_paths')
            .select('id')
            .ilike('company_name', `%${company_name}%`)
            .eq('department', intent_purpose)
            .maybeSingle()

          ivr_path_id = ivrPath?.id || null
        }

        const { data, error } = await serviceClient
          .from('call_contexts')
          .insert({
            user_id: userId,
            intent_category,
            intent_purpose,
            company_name: company_name || null,
            gathered_info: gathered_info || {},
            ivr_path_id,
            status: 'gathering'
          })
          .select()
          .single()

        if (error) throw error
        return { success: true, data: { context_id: data.id } }
      }

      case "lookup_contact": {
        const { name } = args as { name: string }
        const { data, error } = await serviceClient
          .from('user_contacts')
          .select('*')
          .eq('user_id', userId)
          .ilike('name', `%${name}%`)

        if (error) throw error
        return { success: true, data: data || [] }
      }

      default:
        return { success: false, error: `Unknown function: ${functionName}` }
    }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

async function getUserContext(userId: string, serviceClient: ReturnType<typeof createClient>) {
  // Fetch all context data in parallel for speed
  const [memoriesResult, contactsResult, ivrPathsResult] = await Promise.all([
    serviceClient.from('user_memories').select('key, value, category').eq('user_id', userId),
    serviceClient.from('user_contacts').select('name, phone_number, type, company').eq('user_id', userId),
    serviceClient.from('ivr_paths').select('company_name, department, phone_number, required_info, operating_hours')
  ])

  const memories = memoriesResult.data
  const contacts = contactsResult.data
  const ivrPaths = ivrPathsResult.data

  const memoriesText = memories?.length
    ? memories.map(m => `- ${m.key}: ${m.value} (${m.category})`).join('\n')
    : 'No saved memories yet.'

  const contactsText = contacts?.length
    ? contacts.map(c => `- ${c.name}: ${c.phone_number}${c.company ? ` (${c.company})` : ''}`).join('\n')
    : 'No saved contacts yet.'

  const ivrText = ivrPaths?.length
    ? ivrPaths.map(i => `- ${i.company_name} (${i.department}): ${i.phone_number}\n  Required: ${(i.required_info as string[])?.join(', ') || 'None'}\n  Hours: ${i.operating_hours || 'Unknown'}`).join('\n')
    : 'No IVR paths configured.'

  return { memoriesText, contactsText, ivrText }
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
    if (authError) {
      console.error('Auth error:', authError.message)
      throw new Error(`Authentication failed: ${authError.message}`)
    }
    if (!user) {
      throw new Error('No user session found - please sign in again')
    }

    const { messages, current_call_id, conversation_id } = await req.json()

    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) {
      throw new Error('OpenAI API key not configured')
    }

    // Detect if user is confirming (yes/ok/proceed/confirm/ready/let's go/etc.)
    const lastUserMessageContent = messages[messages.length - 1]?.content?.toLowerCase() || ''
    const confirmationKeywords = ['yes', 'ok', 'okay', 'proceed', 'confirm', 'ready', "let's go", 'lets go', 'sure', 'yep', 'yeah', 'go ahead']
    const isConfirming = confirmationKeywords.some(keyword => lastUserMessageContent.includes(keyword))

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get user context (memories, contacts, IVR paths)
    const { memoriesText, contactsText, ivrText } = await getUserContext(user.id, serviceClient)

    // Build personalized system prompt
    const personalizedPrompt = systemPrompt
      .replace('{USER_MEMORIES}', memoriesText)
      .replace('{USER_CONTACTS}', contactsText)
      .replace('{IVR_PATHS}', ivrText)

    // Force place_call if user is confirming and we have phone context
    let functionCallParam: 'auto' | { name: string } = 'auto'
    if (isConfirming && messages.some(m => m.content?.toLowerCase().includes('call') || m.content?.toLowerCase().includes('phone'))) {
      functionCallParam = { name: 'place_call' }
      console.log('[chat] User is confirming, forcing place_call function')
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o', // Faster than gpt-4-turbo
        messages: [
          { role: 'system', content: personalizedPrompt },
          ...messages
        ],
        functions,
        function_call: functionCallParam,
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

    let result: {
      message?: string
      function_call?: { name: string; arguments: Record<string, unknown> }
      function_result?: unknown
    } = {}

    if (choice.message.function_call) {
      const functionCall = choice.message.function_call
      const functionArgs = JSON.parse(functionCall.arguments)

      console.log('[chat] Function call:', functionCall.name)
      console.log('[chat] Function args:', JSON.stringify(functionArgs))

      result.function_call = {
        name: functionCall.name,
        arguments: functionArgs
      }
      result.message = choice.message.content || undefined

      // Execute non-call functions immediately
      if (!['place_call', 'hang_up_call', 'send_dtmf'].includes(functionCall.name)) {
        const funcResult = await executeFunction(
          functionCall.name,
          functionArgs,
          user.id,
          serviceClient
        )
        result.function_result = funcResult

        // If function executed, get a follow-up response from GPT
        if (funcResult.success) {
          const followUpResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openaiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'gpt-4o', // Faster than gpt-4-turbo
              messages: [
                { role: 'system', content: personalizedPrompt },
                ...messages,
                { role: 'assistant', content: null, function_call: functionCall },
                { role: 'function', name: functionCall.name, content: JSON.stringify(funcResult) }
              ],
              temperature: 0.7,
              max_tokens: 300,
            }),
          })

          if (followUpResponse.ok) {
            const followUpData = await followUpResponse.json()
            result.message = followUpData.choices[0].message.content
          }
        }
      }
    } else {
      result.message = choice.message.content
    }

    // Store user message
    const lastUserMessage = messages[messages.length - 1]
    if (lastUserMessage?.role === 'user') {
      await serviceClient.from('messages').insert({
        user_id: user.id,
        role: 'user',
        content: lastUserMessage.content,
        call_id: current_call_id || null,
        conversation_id: conversation_id || null,
      })
    }

    // Store assistant response
    if (result.message) {
      await serviceClient.from('messages').insert({
        user_id: user.id,
        role: 'assistant',
        content: result.message,
        call_id: current_call_id || null,
        conversation_id: conversation_id || null,
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

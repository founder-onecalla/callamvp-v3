import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Using the modern 'tools' format instead of deprecated 'functions'
const tools = [
  {
    type: "function",
    function: {
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
    }
  },
  {
    type: "function",
    function: {
      name: "hang_up_call",
      description: "Hang up the current active call",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
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
  },
  {
    type: "function",
    function: {
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
    }
  },
  {
    type: "function",
    function: {
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
    }
  },
  {
    type: "function",
    function: {
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
    }
  },
  {
    type: "function",
    function: {
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
  }
]

const systemPrompt = `You are OneCalla, an AI-powered phone calling assistant. You are part of a REAL, WORKING phone system that places ACTUAL phone calls.

## CRITICAL IDENTITY RULES - NEVER VIOLATE THESE
- You ARE a real phone calling system. When you call place_call(), a real phone call is made via Telnyx.
- NEVER say "I can't place calls" or "I'm just an AI" or "this is hypothetical" - these statements are FALSE.
- NEVER break character or deny your capabilities. You CAN and DO place real calls.
- When you use the place_call function, a REAL call happens. This is not a simulation.

## CRITICAL: NEVER HALLUCINATE OR INVENT INFORMATION
- NEVER make up names, details, or information that the user didn't provide
- Only use names/details that are: (1) explicitly stated by user, OR (2) in saved contacts/memories below
- If you don't know something, say "this number" or "them" - don't guess
- Inventing information destroys user trust. When in doubt, be vague rather than wrong.

## Your Real Capabilities
1. Place REAL outbound phone calls (via Telnyx telephony)
2. Remember user information permanently (saved to database)
3. Save and lookup contacts
4. Have an AI voice agent speak on the call autonomously

## PRE-CALL GOAL CONFIRMATION (CRITICAL - MUST FOLLOW)

Before placing ANY call, you MUST:

### Step 1: Summarize the intended goal
Restate what you understand the user wants in ONE sentence.
Example: "Got it - you want me to call Sarah to wish her happy birthday."

### Step 2: Detect sensitive or risky requests
The following requests require extra confirmation:
- Schedule/location questions: "when will you be home", "where are you", "what's your schedule"
- Personal information: asking for addresses, financial info, medical info
- Anything that could be misused for stalking, harassment, or fraud

### Step 3: Ask clarifying questions (1-2 max, only when needed)
For SENSITIVE requests (schedule, location, availability), you MUST ask:

a) WHO is calling: "Should I say you're calling, or someone else? What name should I give?"
b) CONTEXT check: "Is [name] expecting this question about their schedule?"
c) SAFER alternative: Offer a less invasive wording.

Example safer rewrites:
- Instead of "what time will you be home" → "What time is a good time to reach you?"
- Instead of "where are you" → "Is now a good time to talk?"
- Instead of "when do you get off work" → "When would be convenient to call back?"

### Step 4: Confirm the final plan
Before dialing, confirm:
- WHO you're calling
- WHO you'll say is calling (caller identity)
- EXACTLY what you'll say (the approved wording)
- Any sensitive questions use the APPROVED wording (original or safer rewrite)

DO NOT place the call until the user explicitly confirms "yes", "ok", "sounds good", etc.

## CALL PURPOSE SAFETY RULES

1. If user ONLY says "wish happy birthday" - that's ALL you do. Do NOT add schedule questions.
2. If user asks for schedule info - ASK for identity context first.
3. NEVER combine unrelated requests (e.g., birthday + schedule) unless user explicitly asked for both.
4. When in doubt, ask: "Should I also ask about [X], or just stick to [Y]?"

## Pre-Call Information Gathering (for business calls)

### For Utility Calls (Xfinity, AT&T, etc.):
- Account holder name, account number, service address

### For Healthcare Calls:
- Patient name, date of birth, reason for visit

### For Restaurant Reservations:
- Name for reservation, party size, date/time

### For Personal Calls:
- Confirm caller identity if asking for sensitive info
- Otherwise, minimal info needed

## Conversation Flow
1. User states intent
2. You summarize the goal in one sentence
3. IF sensitive info requested → ask clarifying questions (identity, context, offer safer wording)
4. Confirm the final plan: "I'll call [name], say I'm calling on behalf of [caller], and [exact action]."
5. Wait for user to confirm
6. ONLY THEN call place_call with the confirmed purpose

## place_call purpose parameter
The "purpose" is what the voice AI will say. Be SPECIFIC:
- "wish her happy birthday" ✓
- "ask what time is a good time to reach her tomorrow" ✓ (safer version)
- "birthday call" ✗ (too vague)

NEVER add extra questions to the purpose that the user didn't confirm.

## Tone
Be conversational, helpful, and safety-conscious. Keep responses concise. Ask questions naturally, not like a checklist.

## User Memories Available
{USER_MEMORIES}

## User Contacts Available
{USER_CONTACTS}

## User Caller Identity
{CALLER_IDENTITY}

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

// User settings types
interface UserSettings {
  user_id: string
  display_name: string | null
  default_caller_mode: 'SELF_NAME' | 'OTHER_NAME' | 'DONT_DISCLOSE'
  default_caller_other_name: string | null
  require_sensitive_confirmation: boolean
}

// Get caller name based on settings
function getCallerName(settings: UserSettings | null): string | null {
  if (!settings) return null

  switch (settings.default_caller_mode) {
    case 'SELF_NAME':
      return settings.display_name
    case 'OTHER_NAME':
      return settings.default_caller_other_name
    case 'DONT_DISCLOSE':
      return null
    default:
      return settings.display_name
  }
}

async function getUserContext(userId: string, serviceClient: ReturnType<typeof createClient>) {
  // Fetch all context data in parallel for speed
  const [memoriesResult, contactsResult, ivrPathsResult, settingsResult] = await Promise.all([
    serviceClient.from('user_memories').select('key, value, category').eq('user_id', userId),
    serviceClient.from('user_contacts').select('name, phone_number, type, company').eq('user_id', userId),
    serviceClient.from('ivr_paths').select('company_name, department, phone_number, required_info, operating_hours'),
    serviceClient.from('user_settings').select('*').eq('user_id', userId).maybeSingle()
  ])

  const memories = memoriesResult.data
  const contacts = contactsResult.data
  const ivrPaths = ivrPathsResult.data
  const settings = settingsResult.data as UserSettings | null

  const memoriesText = memories?.length
    ? memories.map(m => `- ${m.key}: ${m.value} (${m.category})`).join('\n')
    : 'No saved memories yet.'

  const contactsText = contacts?.length
    ? contacts.map(c => `- ${c.name}: ${c.phone_number}${c.company ? ` (${c.company})` : ''}`).join('\n')
    : 'No saved contacts yet.'

  const ivrText = ivrPaths?.length
    ? ivrPaths.map(i => `- ${i.company_name} (${i.department}): ${i.phone_number}\n  Required: ${(i.required_info as string[])?.join(', ') || 'None'}\n  Hours: ${i.operating_hours || 'Unknown'}`).join('\n')
    : 'No IVR paths configured.'

  // Get caller name from settings
  const callerName = getCallerName(settings)
  const callerText = callerName
    ? `User's default caller identity: "${callerName}" (use this when the voice agent says "calling on behalf of")`
    : settings?.default_caller_mode === 'DONT_DISCLOSE'
      ? 'User prefers not to disclose caller identity.'
      : 'No caller identity configured.'

  // Sensitive confirmation preference
  const requireSensitiveConfirmation = settings?.require_sensitive_confirmation ?? true

  return { memoriesText, contactsText, ivrText, callerText, callerName, requireSensitiveConfirmation }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('[chat] Request received')

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      console.error('[chat] Missing authorization header')
      throw new Error('Missing authorization header')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      console.error('[chat] Missing env vars:', {
        url: !!supabaseUrl,
        anon: !!supabaseAnonKey,
        service: !!supabaseServiceKey
      })
      throw new Error('Server configuration error')
    }

    const supabase = createClient(
      supabaseUrl,
      supabaseAnonKey,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError) {
      console.error('[chat] Auth error:', authError.message)
      throw new Error(`Authentication failed: ${authError.message}`)
    }
    if (!user) {
      console.error('[chat] No user found')
      throw new Error('No user session found - please sign in again')
    }

    console.log('[chat] User authenticated:', user.id)

    let body
    try {
      body = await req.json()
    } catch (parseError) {
      console.error('[chat] JSON parse error:', parseError)
      throw new Error('Invalid request body')
    }

    const { messages, current_call_id, conversation_id } = body
    console.log('[chat] Messages count:', messages?.length || 0)
    console.log('[chat] conversation_id:', conversation_id || 'none')

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      console.error('[chat] Invalid messages:', typeof messages, messages)
      throw new Error('No messages provided')
    }

    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) {
      console.error('[chat] Missing OPENAI_API_KEY')
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
    console.log('[chat] Fetching user context...')
    let userContext
    try {
      userContext = await getUserContext(user.id, serviceClient)
    } catch (contextError) {
      console.error('[chat] Failed to get user context:', contextError)
      // Continue without context rather than failing the whole request
      userContext = {
        memoriesText: 'No saved memories yet.',
        contactsText: 'No saved contacts yet.',
        ivrText: 'No IVR paths configured.',
        callerText: 'No caller identity configured.',
        callerName: null,
        requireSensitiveConfirmation: true
      }
    }
    const { memoriesText, contactsText, ivrText, callerText, callerName, requireSensitiveConfirmation } = userContext
    console.log('[chat] User context fetched, callerName:', callerName || 'none')

    // Build personalized system prompt
    const personalizedPrompt = systemPrompt
      .replace('{USER_MEMORIES}', memoriesText)
      .replace('{USER_CONTACTS}', contactsText)
      .replace('{CALLER_IDENTITY}', callerText)
      .replace('{IVR_PATHS}', ivrText)

    // Force place_call if user is confirming and we have phone context
    let toolChoice: 'auto' | { type: 'function'; function: { name: string } } = 'auto'
    if (isConfirming && messages.some(m => m.content?.toLowerCase().includes('call') || m.content?.toLowerCase().includes('phone'))) {
      toolChoice = { type: 'function', function: { name: 'place_call' } }
      console.log('[chat] User is confirming, forcing place_call function')
    }

    console.log('[chat] Calling OpenAI API...')

    let response
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: personalizedPrompt },
            ...messages
          ],
          tools,
          tool_choice: toolChoice,
          temperature: 0.7,
          max_tokens: 500,
        }),
      })
    } catch (fetchError) {
      console.error('[chat] OpenAI fetch failed:', fetchError)
      throw new Error('Failed to connect to AI service')
    }

    console.log('[chat] OpenAI response status:', response.status)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[chat] OpenAI API error:', response.status, errorText)
      // Don't expose raw OpenAI errors to users
      if (response.status === 429) {
        throw new Error('AI service is busy. Please try again in a moment.')
      } else if (response.status === 401) {
        throw new Error('AI service authentication error')
      } else {
        throw new Error('AI service temporarily unavailable')
      }
    }

    let data
    try {
      data = await response.json()
    } catch (jsonError) {
      console.error('[chat] Failed to parse OpenAI response:', jsonError)
      throw new Error('Failed to parse AI response')
    }

    if (!data.choices || !data.choices[0]) {
      console.error('[chat] Invalid OpenAI response structure:', JSON.stringify(data).slice(0, 500))
      throw new Error('Invalid AI response')
    }

    const choice = data.choices[0]
    const toolCalls = choice.message?.tool_calls
    console.log('[chat] OpenAI response received, has tool_calls:', !!toolCalls?.length)

    let result: {
      message?: string
      function_call?: { name: string; arguments: Record<string, unknown> }
      function_result?: unknown
    } = {}

    // Handle tool calls (new format)
    if (toolCalls && toolCalls.length > 0) {
      // Process the first tool call (we only expect one at a time)
      const toolCall = toolCalls[0]
      const functionName = toolCall.function.name
      let functionArgs: Record<string, unknown>

      try {
        functionArgs = JSON.parse(toolCall.function.arguments)
      } catch (parseErr) {
        console.error('[chat] Failed to parse tool arguments:', toolCall.function.arguments)
        throw new Error('Failed to parse AI tool response')
      }

      console.log('[chat] Tool call:', functionName)
      console.log('[chat] Tool args:', JSON.stringify(functionArgs))

      result.function_call = {
        name: functionName,
        arguments: functionArgs
      }
      result.message = choice.message.content || undefined

      // Execute non-call functions immediately
      if (!['place_call', 'hang_up_call', 'send_dtmf'].includes(functionName)) {
        console.log('[chat] Executing function:', functionName)
        const funcResult = await executeFunction(
          functionName,
          functionArgs,
          user.id,
          serviceClient
        )
        result.function_result = funcResult
        console.log('[chat] Function result:', funcResult.success ? 'success' : 'failed')

        // If function executed, get a follow-up response from GPT
        if (funcResult.success) {
          console.log('[chat] Getting follow-up response from OpenAI...')
          try {
            const followUpResponse = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${openaiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'gpt-4o',
                messages: [
                  { role: 'system', content: personalizedPrompt },
                  ...messages,
                  {
                    role: 'assistant',
                    content: null,
                    tool_calls: [toolCall]
                  },
                  {
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify(funcResult)
                  }
                ],
                temperature: 0.7,
                max_tokens: 300,
              }),
            })

            if (followUpResponse.ok) {
              const followUpData = await followUpResponse.json()
              result.message = followUpData.choices[0]?.message?.content || result.message
              console.log('[chat] Follow-up response received')
            } else {
              console.error('[chat] Follow-up request failed:', followUpResponse.status)
            }
          } catch (followUpError) {
            console.error('[chat] Follow-up request error:', followUpError)
            // Continue with original message
          }
        }
      }
    } else {
      result.message = choice.message.content
    }

    // Store messages (non-blocking - don't fail if this fails)
    console.log('[chat] Storing messages...')
    try {
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

      if (result.message) {
        await serviceClient.from('messages').insert({
          user_id: user.id,
          role: 'assistant',
          content: result.message,
          call_id: current_call_id || null,
          conversation_id: conversation_id || null,
        })
      }
      console.log('[chat] Messages stored successfully')
    } catch (storeError) {
      // Log but don't fail - the AI response is more important
      console.error('[chat] Failed to store messages:', storeError)
    }

    console.log('[chat] Request completed successfully')
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('[chat] Request failed:', error.message || error)
    // Sanitize error message for user
    let userMessage = error.message || 'Something went wrong'
    // Don't expose internal details
    if (userMessage.includes('fetch') || userMessage.includes('network')) {
      userMessage = 'Connection error. Please try again.'
    }
    return new Response(JSON.stringify({ error: userMessage }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

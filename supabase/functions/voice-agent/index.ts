import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ConversationTurn {
  role: 'agent' | 'human'
  content: string
  timestamp: string
}

interface CallContext {
  intent_category: string
  intent_purpose: string
  company_name: string | null
  gathered_info: Record<string, string>
}

const systemPrompt = `You are making a phone call on behalf of someone. Speak naturally like a real person.

## CRITICAL RULES
1. Your ONLY job is to accomplish the PURPOSE stated below
2. NEVER use placeholder text like [Your Name] or [specific issue]
3. NEVER invent names, account numbers, or details not given
4. Keep responses SHORT - 1-2 sentences max

## When to END the call (say goodbye and set end_call: true):
- You accomplished the PURPOSE (got the answer, delivered the message, etc.)
- They say goodbye, "talk to you later", "thanks bye", etc.
- They ask you to call back later
- The conversation has naturally concluded
- They seem confused or want to end the call

## When to CONTINUE (set end_call: false):
- Still waiting for information you need
- They asked a question you need to answer
- The PURPOSE is not yet accomplished

## During the Call
- Listen and respond naturally
- If asked who you are: "I'm calling on behalf of a friend"
- If they ask you to hold: "Sure, no problem"
- When ending: Say a warm goodbye like "Thanks so much! Take care!" or "Alright, bye!"

## Current Call Context
{CALL_CONTEXT}

## Conversation So Far
{CONVERSATION_HISTORY}

Respond with JSON: {"response": "your spoken words", "end_call": true/false}`

interface AgentResponse {
  response: string
  end_call: boolean
}

async function generateResponse(
  openaiKey: string,
  callContext: CallContext | null,
  conversationHistory: ConversationTurn[],
  isOpening: boolean
): Promise<AgentResponse> {
  // Build context string
  let contextStr = 'No specific context available - just have a friendly conversation.'
  if (callContext) {
    // Make the PURPOSE very prominent so the AI uses it
    const purpose = callContext.intent_purpose || 'General conversation'
    contextStr = `
**PURPOSE OF THIS CALL**: ${purpose}
Company/Person: ${callContext.company_name || 'Personal call'}
Additional Info: ${JSON.stringify(callContext.gathered_info || {})}`
    console.log('[voice-agent] Using call context:', { purpose, company: callContext.company_name })
  } else {
    console.log('[voice-agent] WARNING: No call context found!')
  }

  // Build conversation history string
  let historyStr = 'No conversation yet - this is the opening.'
  if (conversationHistory.length > 0) {
    historyStr = conversationHistory
      .map(turn => `${turn.role === 'agent' ? 'You' : 'Them'}: ${turn.content}`)
      .join('\n')
  }

  const prompt = systemPrompt
    .replace('{CALL_CONTEXT}', contextStr)
    .replace('{CONVERSATION_HISTORY}', historyStr)

  const userMessage = isOpening
    ? 'Generate your opening statement for this call. Introduce yourself briefly and state why you\'re calling.'
    : 'Generate your response to what they just said. Be natural and conversational.'

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.8,
      max_tokens: 200,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${await response.text()}`)
  }

  const data = await response.json()
  const content = data.choices[0].message.content

  try {
    const parsed = JSON.parse(content) as AgentResponse
    return {
      response: parsed.response || content,
      end_call: parsed.end_call || false
    }
  } catch {
    // If JSON parsing fails, treat as plain text response
    return {
      response: content,
      end_call: false
    }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('[voice-agent] ========== REQUEST RECEIVED ==========')

    const body = await req.json()
    const { call_id, transcription, is_opening } = body
    console.log('[voice-agent] call_id:', call_id)
    console.log('[voice-agent] is_opening:', is_opening)
    console.log('[voice-agent] transcription:', transcription?.substring(0, 100) || 'none')

    if (!call_id) {
      console.error('[voice-agent] ERROR: No call_id provided')
      throw new Error('call_id is required')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[voice-agent] ERROR: Missing Supabase credentials')
      throw new Error('Missing Supabase credentials')
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey)

    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    const telnyxApiKey = Deno.env.get('TELNYX_API_KEY')

    console.log('[voice-agent] API keys present:', { openai: !!openaiKey, telnyx: !!telnyxApiKey })

    if (!openaiKey || !telnyxApiKey) {
      console.error('[voice-agent] ERROR: Missing API keys')
      throw new Error('Missing required API keys (OPENAI_API_KEY, TELNYX_API_KEY)')
    }

    // Get all call data in parallel for speed (saves ~300ms)
    const [callResult, contextResult, transcriptionsResult, agentEventsResult] = await Promise.all([
      serviceClient.from('calls').select('*').eq('id', call_id).single(),
      serviceClient.from('call_contexts').select('*').eq('call_id', call_id).maybeSingle(),
      serviceClient.from('transcriptions').select('*').eq('call_id', call_id).order('created_at', { ascending: true }),
      serviceClient.from('call_events').select('*').eq('call_id', call_id).eq('event_type', 'agent_speech').order('created_at', { ascending: true })
    ])

    const call = callResult.data
    const context = contextResult.data
    const transcriptions = transcriptionsResult.data
    const agentEvents = agentEventsResult.data

    if (!call) {
      throw new Error('Call not found')
    }

    // Build conversation history
    const conversationHistory: ConversationTurn[] = []

    // Merge transcriptions and agent speech into chronological order
    const allEvents = [
      ...(transcriptions || []).map(t => ({
        type: 'transcription' as const,
        content: t.content,
        speaker: t.speaker,
        created_at: t.created_at
      })),
      ...(agentEvents || []).map(e => ({
        type: 'agent' as const,
        content: e.description,
        speaker: 'agent',
        created_at: e.created_at
      }))
    ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

    for (const event of allEvents) {
      if (event.type === 'transcription') {
        conversationHistory.push({
          role: event.speaker === 'user' ? 'agent' : 'human',
          content: event.content,
          timestamp: event.created_at
        })
      } else {
        conversationHistory.push({
          role: 'agent',
          content: event.content,
          timestamp: event.created_at
        })
      }
    }

    // Add current transcription if provided
    if (transcription) {
      conversationHistory.push({
        role: 'human',
        content: transcription,
        timestamp: new Date().toISOString()
      })
    }

    console.log('[voice-agent] Generating response for call:', call_id)
    console.log('[voice-agent] Is opening:', is_opening)
    console.log('[voice-agent] Conversation history length:', conversationHistory.length)

    // Generate AI response
    const agentResponse = await generateResponse(
      openaiKey,
      context as CallContext | null,
      conversationHistory,
      is_opening
    )

    const responseText = agentResponse.response
    const shouldEndCall = agentResponse.end_call

    console.log('[voice-agent] Generated response:', responseText)
    console.log('[voice-agent] Should end call:', shouldEndCall)

    // Play audio via Telnyx speak command (uses Telnyx's built-in TTS)
    console.log('[voice-agent] Call data:', {
      call_id: call.id,
      telnyx_call_id: call.telnyx_call_id,
      status: call.status
    })

    if (call.telnyx_call_id) {
      console.log('[voice-agent] Sending speak command to Telnyx...')
      // Use Telnyx speak command
      const speakResponse = await fetch(
        `https://api.telnyx.com/v2/calls/${call.telnyx_call_id}/actions/speak`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${telnyxApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            payload: responseText,
            voice: 'female',
            language: 'en-US',
          }),
        }
      )

      const speakResponseText = await speakResponse.text()
      console.log('[voice-agent] Telnyx speak response:', speakResponse.status, speakResponseText)

      if (!speakResponse.ok) {
        console.error('[voice-agent] Telnyx speak FAILED:', speakResponseText)
      } else {
        console.log('[voice-agent] Speech successfully sent to Telnyx')

        // If AI decided to end call, set closing state (don't hang up yet - wait for mutual goodbye)
        if (shouldEndCall) {
          console.log('[voice-agent] AI said goodbye, entering closing_said state...')
          await serviceClient
            .from('calls')
            .update({
              closing_state: 'closing_said',
              closing_started_at: new Date().toISOString()
            })
            .eq('id', call_id)
          console.log('[voice-agent] Call state updated to closing_said, waiting for mutual goodbye')
        }
      }
    } else {
      console.error('[voice-agent] No telnyx_call_id found - cannot speak!')
    }

    // Log agent speech as event
    await serviceClient.from('call_events').insert({
      call_id,
      event_type: 'agent_speech',
      description: responseText,
      metadata: { is_opening, end_call: shouldEndCall }
    })

    return new Response(JSON.stringify({
      success: true,
      response: responseText,
      end_call: shouldEndCall
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('[voice-agent] Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

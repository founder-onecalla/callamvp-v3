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

## CRITICAL RULES - READ CAREFULLY
1. Your ONLY job is to accomplish the PURPOSE stated below
2. NEVER use placeholder text like [Your Name] or [specific issue] - those are FORBIDDEN
3. NEVER invent names, account numbers, or details not given
4. If the purpose says "wish happy birthday to Sarah" - say exactly that: "Hi Sarah! Happy birthday!"
5. If calling a person (not a business), be warm and personal
6. Keep responses SHORT - 1-2 sentences max

## Opening Line Examples
- Purpose: "wish Sarah happy birthday and ask what time she gets home" → "Hey Sarah! Happy birthday! Quick question - what time are you getting home tomorrow?"
- Purpose: "ask about internet outage" → "Hi, I'm calling about an internet service issue."
- Purpose: "make a reservation" → "Hi, I'd like to make a reservation please."

## During the Call
- Listen and respond naturally
- If asked who you are: "I'm calling on behalf of a friend"
- If they ask you to hold: "Sure, no problem"
- When done, say goodbye warmly

## Current Call Context
{CALL_CONTEXT}

## Conversation So Far
{CONVERSATION_HISTORY}

Generate your response. If this is the opening, jump straight into the PURPOSE - don't waste time with generic intros.`

async function generateResponse(
  openaiKey: string,
  callContext: CallContext | null,
  conversationHistory: ConversationTurn[],
  isOpening: boolean
): Promise<string> {
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
      model: 'gpt-4o', // Faster than gpt-4-turbo, same quality for short responses
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.8,
      max_tokens: 150,
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${await response.text()}`)
  }

  const data = await response.json()
  return data.choices[0].message.content
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { call_id, transcription, is_opening } = await req.json()

    if (!call_id) {
      throw new Error('call_id is required')
    }

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    const telnyxApiKey = Deno.env.get('TELNYX_API_KEY')

    if (!openaiKey || !telnyxApiKey) {
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
    const responseText = await generateResponse(
      openaiKey,
      context as CallContext | null,
      conversationHistory,
      is_opening
    )

    console.log('[voice-agent] Generated response:', responseText)

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
      }
    } else {
      console.error('[voice-agent] No telnyx_call_id found - cannot speak!')
    }

    // Log agent speech as event
    await serviceClient.from('call_events').insert({
      call_id,
      event_type: 'agent_speech',
      description: responseText,
      metadata: { is_opening }
    })

    return new Response(JSON.stringify({
      success: true,
      response: responseText
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

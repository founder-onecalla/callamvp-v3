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

const systemPrompt = `You are a friendly, warm AI assistant making a phone call on behalf of a user. You speak naturally like a real person - casual but professional.

## CRITICAL: NEVER INVENT OR HALLUCINATE INFORMATION
- ONLY use information explicitly provided in the Call Context below
- If you don't have someone's name, say "I'm calling on behalf of a customer" - don't make up names
- If you don't have specific details, be vague rather than inventing them
- NEVER guess account numbers, names, addresses, or other specific information
- If asked for info you don't have, say "Let me check on that" or "I'll need to get that information"
- Inventing information will destroy trust and credibility on the call

## Your Personality
- Warm and friendly, like talking to a helpful neighbor
- Use natural speech patterns ("Hey", "Sure thing", "Got it", "Hmm, let me think...")
- Be conversational, not robotic
- Show empathy and patience
- Keep responses concise - this is a phone call, not an essay

## Call Guidelines
- Introduce yourself naturally based ONLY on the context provided below
- Listen carefully to what they say and respond appropriately
- If they ask you to hold, say something like "Sure, I'll wait"
- If you don't understand something, ask them to repeat
- Be polite but persistent in achieving the goal
- When the goal is achieved, thank them warmly and end the call

## IVR/Automated Systems
- If you hear menu options, choose the appropriate one
- Say the number clearly: "I'll press 1" or just respond with the selection
- If asked to enter numbers (account, phone), say them clearly with pauses

## What NOT to do
- Don't be overly formal or stiff
- Don't give long speeches - keep it conversational
- Don't say "As an AI" or reveal you're an AI unless directly asked
- Don't repeat yourself unnecessarily

## Current Call Context
{CALL_CONTEXT}

## Conversation So Far
{CONVERSATION_HISTORY}

Generate your next response. Keep it natural and brief (1-2 sentences typically). If this is the opening, introduce yourself and state the purpose.`

async function generateResponse(
  openaiKey: string,
  callContext: CallContext | null,
  conversationHistory: ConversationTurn[],
  isOpening: boolean
): Promise<string> {
  // Build context string
  let contextStr = 'No specific context available.'
  if (callContext) {
    contextStr = `
Purpose: ${callContext.intent_purpose || 'General inquiry'}
Company: ${callContext.company_name || 'Unknown'}
Category: ${callContext.intent_category || 'General'}
User Info: ${JSON.stringify(callContext.gathered_info || {})}`
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
    // Note: ElevenLabs TTS removed - was generating audio but not using it
    if (call.telnyx_call_id) {
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

      if (!speakResponse.ok) {
        const error = await speakResponse.text()
        console.error('[voice-agent] Telnyx speak error:', error)
        // Don't throw - we still want to log the event
      } else {
        console.log('[voice-agent] Speech sent to Telnyx')
      }
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

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ============================================================================
// VOICE AGENT - State Machine with Natural Pacing
// ============================================================================
// CRITICAL RULES:
// 1. First line MUST be short: "Hi, is this Sarah?" (max 1 sentence)
// 2. Use SPECIFIC names, never "a friend" without context
// 3. ONE utterance per turn, then WAIT
// 4. If challenged, exit gracefully
// ============================================================================

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

// State machine for natural conversation flow
type CallState =
  | 'greeting'        // "Hi, is this Sarah?"
  | 'permission'      // "Is now a good time?"
  | 'identify'        // "This is David's assistant."
  | 'deliver_message' // "David wanted to wish you happy birthday!"
  | 'ask_question'    // "What time works best to reach you tomorrow?"
  | 'confirm'         // "Got it, around 1:00 p.m. Thanks!"
  | 'closing'         // "Thanks so much! Take care, bye!"
  | 'challenged'      // Exit gracefully if they question us

interface ParsedPurpose {
  callerName: string | null
  recipientName: string | null
  message: string | null       // The message to deliver
  question: string | null      // The question to ask (safer form)
  originalQuestion: string | null // Original question for reference
}

/**
 * Parse the call purpose into structured components
 */
function parsePurpose(purpose: string, gatheredInfo: Record<string, string>): ParsedPurpose {
  const result: ParsedPurpose = {
    callerName: gatheredInfo.caller_name || gatheredInfo.callerName || null,
    recipientName: gatheredInfo.recipient_name || gatheredInfo.recipientName || null,
    message: null,
    question: null,
    originalQuestion: null
  }

  const lowerPurpose = purpose.toLowerCase()

  // Extract messages (birthday wishes, greetings, etc.)
  if (lowerPurpose.includes('happy birthday') || lowerPurpose.includes('birthday')) {
    result.message = 'happy birthday'
  } else if (lowerPurpose.includes('say hello') || lowerPurpose.includes('say hi')) {
    result.message = 'hello'
  } else if (lowerPurpose.includes('thank')) {
    result.message = 'thank you'
  }

  // Extract questions and convert to safer form
  // "what time will you be home" -> "what time works best to reach you"
  if (lowerPurpose.includes('what time') || lowerPurpose.includes('when')) {
    result.originalQuestion = purpose
    // Use safer phrasing by default
    result.question = "What time works best to reach you tomorrow?"
  }

  // If no structured extraction and it's a simple message
  if (!result.message && !result.question && purpose.length < 100) {
    result.message = purpose
  }

  return result
}

/**
 * Determine current call state based on conversation history
 */
function determineCallState(
  conversationHistory: ConversationTurn[],
  parsedPurpose: ParsedPurpose,
  isOpening: boolean
): CallState {
  const agentTurns = conversationHistory.filter(t => t.role === 'agent')
  const humanTurns = conversationHistory.filter(t => t.role === 'human')
  const lastHuman = humanTurns[humanTurns.length - 1]?.content?.toLowerCase() || ''

  // Opening - no conversation yet
  if (isOpening || agentTurns.length === 0) {
    return 'greeting'
  }

  // Check for challenges or discomfort
  const challengePhrases = [
    'who is this', 'who are you', 'why are you calling',
    'why do you need', 'why are you asking', "don't want to",
    'not comfortable', 'how did you get', 'is this a scam',
    'stop calling', 'not interested'
  ]
  if (challengePhrases.some(phrase => lastHuman.includes(phrase))) {
    return 'challenged'
  }

  // Check for goodbye signals
  const farewells = ['bye', 'goodbye', 'take care', 'talk later', 'have a good']
  if (farewells.some(phrase => lastHuman.includes(phrase))) {
    return 'closing'
  }

  // Check what we've already said
  const agentSaid = agentTurns.map(t => t.content.toLowerCase()).join(' ')

  const saidGreeting = agentSaid.includes('is this') || agentSaid.includes('hi,') || agentSaid.includes('hello')
  const askedPermission = agentSaid.includes('good time') || agentSaid.includes('now ok')
  const saidIdentity = agentSaid.includes('assistant') || agentSaid.includes('calling on behalf') || agentSaid.includes("'s assistant")
  const deliveredMessage = parsedPurpose.message && (
    agentSaid.includes('happy birthday') ||
    agentSaid.includes('wanted to say') ||
    agentSaid.includes('wanted to wish')
  )
  const askedQuestion = parsedPurpose.question && (
    agentSaid.includes('what time') ||
    agentSaid.includes('when')
  )

  // Check for answer to our question
  const gotTimeAnswer = askedQuestion && humanTurns.length > 0 && (
    lastHuman.match(/\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.?m\.?|p\.?m\.?)?/i) ||
    lastHuman.includes('morning') ||
    lastHuman.includes('afternoon') ||
    lastHuman.includes('evening') ||
    lastHuman.includes('tonight') ||
    lastHuman.includes('tomorrow')
  )

  // Determine next state based on progression
  if (!saidGreeting) return 'greeting'

  // After greeting, check their response
  if (saidGreeting && !saidIdentity) {
    // They answered our "is this X?" question
    const confirmedIdentity = lastHuman.includes('yes') || lastHuman.includes('yeah') || lastHuman.includes('speaking') || lastHuman.includes('this is')
    const deniedIdentity = lastHuman.includes('no') || lastHuman.includes("wrong number") || lastHuman.includes("who")

    if (deniedIdentity) {
      return 'closing' // Wrong number
    }
    if (confirmedIdentity || humanTurns.length > 0) {
      return 'identify' // Move to identifying ourselves
    }
  }

  if (saidIdentity && !deliveredMessage && parsedPurpose.message) {
    return 'deliver_message'
  }

  if ((deliveredMessage || !parsedPurpose.message) && !askedQuestion && parsedPurpose.question) {
    return 'ask_question'
  }

  if (askedQuestion && gotTimeAnswer) {
    return 'confirm'
  }

  // Default to closing if we've done everything
  if ((deliveredMessage || !parsedPurpose.message) && (gotTimeAnswer || !parsedPurpose.question)) {
    return 'closing'
  }

  // Stay in current flow
  if (deliveredMessage) return 'closing'
  if (saidIdentity) return 'deliver_message'
  return 'identify'
}

/**
 * Generate response for current state - ONE short utterance
 */
function generateStateResponse(
  state: CallState,
  parsedPurpose: ParsedPurpose,
  lastHumanResponse: string | null
): { response: string; end_call: boolean } {
  const recipientName = parsedPurpose.recipientName
  const callerName = parsedPurpose.callerName

  switch (state) {
    case 'greeting':
      // FIRST LINE: Short identity check only
      // RULE: Max 1 sentence, must include specific name if known
      if (recipientName) {
        return { response: `Hi, is this ${recipientName}?`, end_call: false }
      }
      return { response: `Hi there!`, end_call: false }

    case 'identify':
      // Introduce ourselves with specific name
      // RULE: Never say "a friend" - use the actual caller name
      if (callerName) {
        return {
          response: `Hi! This is ${callerName}'s assistant calling with a quick message. Is now a good time?`,
          end_call: false
        }
      }
      return {
        response: `Hi! I'm calling with a quick message. Is now a good time?`,
        end_call: false
      }

    case 'deliver_message':
      // Deliver the message
      if (parsedPurpose.message === 'happy birthday') {
        if (callerName) {
          return { response: `${callerName} wanted to wish you a happy birthday!`, end_call: false }
        }
        return { response: `I wanted to wish you a happy birthday!`, end_call: false }
      }
      if (parsedPurpose.message) {
        if (callerName) {
          return { response: `${callerName} wanted to say ${parsedPurpose.message}.`, end_call: false }
        }
        return { response: parsedPurpose.message, end_call: false }
      }
      return { response: `I just wanted to reach out.`, end_call: false }

    case 'ask_question':
      // Ask the question (use safer form)
      if (parsedPurpose.question) {
        return { response: parsedPurpose.question, end_call: false }
      }
      return { response: `Is there anything you'd like me to pass along?`, end_call: false }

    case 'confirm':
      // Confirm what we heard
      if (lastHumanResponse) {
        // Extract time from their response
        const timeMatch = lastHumanResponse.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.?m\.?|p\.?m\.?)?)\b/i)
        if (timeMatch) {
          return { response: `Got it, around ${timeMatch[1]}. I'll let them know. Thanks!`, end_call: false }
        }
        // Check for relative times
        if (lastHumanResponse.toLowerCase().includes('afternoon')) {
          return { response: `Got it, sometime in the afternoon. I'll let them know. Thanks!`, end_call: false }
        }
        if (lastHumanResponse.toLowerCase().includes('evening')) {
          return { response: `Got it, sometime in the evening. I'll let them know. Thanks!`, end_call: false }
        }
      }
      return { response: `Got it, thanks for letting me know!`, end_call: false }

    case 'closing':
      // Polite goodbye - one sentence
      return { response: `Thanks so much! Take care, bye!`, end_call: true }

    case 'challenged':
      // Exit gracefully when challenged
      // RULE: Don't push, don't explain further, just exit politely
      if (parsedPurpose.message === 'happy birthday' && callerName) {
        return {
          response: `No worries at all! I'll just pass along ${callerName}'s birthday wishes. Take care!`,
          end_call: true
        }
      }
      return {
        response: `No worries! I'll let them know. Have a great day!`,
        end_call: true
      }

    default:
      return { response: `Thanks, have a great day!`, end_call: true }
  }
}

// Log checkpoint for debugging
async function logCheckpoint(
  serviceClient: ReturnType<typeof createClient>,
  callId: string,
  checkpoint: string,
  details?: Record<string, unknown>
) {
  try {
    await serviceClient.from('call_events').insert({
      call_id: callId,
      event_type: 'checkpoint',
      description: checkpoint,
      metadata: { checkpoint, timestamp: new Date().toISOString(), ...details }
    })

    // Also update pipeline_checkpoints on the call record
    const { data: call } = await serviceClient
      .from('calls')
      .select('pipeline_checkpoints')
      .eq('id', callId)
      .single()

    const checkpoints = call?.pipeline_checkpoints || {}
    checkpoints[checkpoint] = new Date().toISOString()

    await serviceClient.from('calls').update({
      pipeline_checkpoints: checkpoints,
      last_activity_at: new Date().toISOString()
    }).eq('id', callId)
  } catch (err) {
    console.error('[voice-agent] Failed to log checkpoint:', err)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('[voice-agent] ========== REQUEST RECEIVED ==========')

    const body = await req.json()
    const { call_id, transcription, is_opening, is_reprompt } = body
    console.log('[voice-agent] call_id:', call_id)
    console.log('[voice-agent] is_opening:', is_opening)
    console.log('[voice-agent] is_reprompt:', is_reprompt)
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
    const telnyxApiKey = Deno.env.get('TELNYX_API_KEY')

    // Log checkpoint: agent received request
    if (is_opening) {
      await logCheckpoint(serviceClient, call_id, 'first_tts_started', { is_opening })
    } else {
      await logCheckpoint(serviceClient, call_id, 'agent_decision_made', { has_transcription: !!transcription })
    }

    // Get all call data in parallel
    const [callResult, contextResult, transcriptionsResult, agentEventsResult] = await Promise.all([
      serviceClient.from('calls').select('*').eq('id', call_id).single(),
      serviceClient.from('call_contexts').select('*').eq('call_id', call_id).maybeSingle(),
      serviceClient.from('transcriptions').select('*').eq('call_id', call_id).order('created_at', { ascending: true }),
      serviceClient.from('call_events').select('*').eq('call_id', call_id).eq('event_type', 'agent_speech').order('created_at', { ascending: true })
    ])

    const call = callResult.data
    const context = contextResult.data as CallContext | null
    const transcriptions = transcriptionsResult.data || []
    const agentEvents = agentEventsResult.data || []

    if (!call) {
      throw new Error('Call not found')
    }

    // Build conversation history
    const conversationHistory: ConversationTurn[] = []

    const allEvents = [
      ...transcriptions.map(t => ({
        type: 'transcription' as const,
        content: t.content,
        speaker: t.speaker,
        created_at: t.created_at
      })),
      ...agentEvents.map(e => ({
        type: 'agent' as const,
        content: e.description,
        speaker: 'agent',
        created_at: e.created_at
      }))
    ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

    for (const event of allEvents) {
      if (event.type === 'transcription') {
        conversationHistory.push({
          role: event.speaker === 'agent' ? 'agent' : 'human',
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

    console.log('[voice-agent] Conversation history length:', conversationHistory.length)

    // Parse the purpose and determine state
    const purpose = context?.intent_purpose || ''
    const gatheredInfo = context?.gathered_info || {}
    const parsedPurpose = parsePurpose(purpose, gatheredInfo)

    console.log('[voice-agent] Parsed purpose:', parsedPurpose)

    // Handle reprompt case
    let responseText: string
    let shouldEndCall: boolean
    let callState: CallState

    if (is_reprompt) {
      // This is a reprompt due to silence
      const repromptCount = call.reprompt_count || 0
      console.log('[voice-agent] Reprompt #', repromptCount + 1)

      if (repromptCount >= 2) {
        // Too many reprompts, exit gracefully
        responseText = "I seem to be having trouble hearing you. I'll follow up another time. Have a great day!"
        shouldEndCall = true
        callState = 'closing'

        // Update reprompt count
        await serviceClient.from('calls').update({
          reprompt_count: repromptCount + 1
        }).eq('id', call_id)
      } else {
        // Try reprompt
        responseText = "Sorry, I didn't catch that. Could you repeat?"
        shouldEndCall = false
        callState = 'greeting' // Keep current state

        // Update reprompt count
        await serviceClient.from('calls').update({
          reprompt_count: repromptCount + 1
        }).eq('id', call_id)
      }
    } else {
      // Normal conversation flow
      callState = determineCallState(conversationHistory, parsedPurpose, is_opening)
      console.log('[voice-agent] Current call state:', callState)

      const lastHuman = conversationHistory.filter(t => t.role === 'human').pop()?.content || null
      const stateResponse = generateStateResponse(callState, parsedPurpose, lastHuman)
      responseText = stateResponse.response
      shouldEndCall = stateResponse.end_call

      // Reset reprompt count on successful conversation
      if (transcription && transcription.length > 0) {
        await serviceClient.from('calls').update({
          reprompt_count: 0,
          silence_started_at: null
        }).eq('id', call_id)
      }
    }

    console.log('[voice-agent] Generated response:', responseText)
    console.log('[voice-agent] Should end call:', shouldEndCall)

    // Send to Telnyx
    if (call.telnyx_call_id && telnyxApiKey) {
      console.log('[voice-agent] Sending speak command to Telnyx...')
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

        // Log checkpoint: TTS started
        if (is_opening) {
          await logCheckpoint(serviceClient, call_id, 'first_tts_completed')
        } else {
          await logCheckpoint(serviceClient, call_id, 'second_tts_started')
        }

        if (shouldEndCall) {
          console.log('[voice-agent] Entering closing state...')
          await serviceClient
            .from('calls')
            .update({
              closing_state: 'closing_said',
              closing_started_at: new Date().toISOString()
            })
            .eq('id', call_id)
        }
      }
    } else {
      console.error('[voice-agent] No telnyx_call_id or API key found!')
    }

    // Log agent speech
    await serviceClient.from('call_events').insert({
      call_id,
      event_type: 'agent_speech',
      description: responseText,
      metadata: { is_opening, is_reprompt, end_call: shouldEndCall, state: callState }
    })

    return new Response(JSON.stringify({
      success: true,
      response: responseText,
      end_call: shouldEndCall,
      state: callState
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('[voice-agent] Error:', error)
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

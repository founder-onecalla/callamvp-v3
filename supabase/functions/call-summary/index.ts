import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ============================================================================
// RECAP STATUS MANAGEMENT
// ============================================================================
// This function updates the call record with recap_status as single source of truth.
// Status values: recap_ready, recap_pending, recap_failed_transient, recap_failed_permanent
// ============================================================================

// End reason code to user-friendly label mapping
const END_REASON_LABELS: Record<string, string> = {
  'MUTUAL_GOODBYE': 'Ended normally',
  'USER_HUNG_UP': 'They hung up',
  'SILENCE_TIMEOUT_AFTER_CLOSING': 'Ended after no response',
  'normal_clearing': 'Ended normally',
  'normal': 'Ended normally',
  'no_answer': 'No answer',
  'busy': 'Line busy',
  'call_rejected': 'Call declined',
  'originator_cancel': 'Call cancelled',
}

// Map database outcome to UI status
function mapOutcomeToStatus(outcome: string | null, wasAnswered: boolean): string {
  if (!outcome) {
    return wasAnswered ? 'completed' : 'failed'
  }
  switch (outcome) {
    case 'completed': return 'completed'
    case 'voicemail': return 'voicemail'
    case 'busy': return 'busy'
    case 'no_answer': return 'no_answer'
    case 'declined': return 'failed'
    case 'cancelled': return 'canceled'
    default: return wasAnswered ? 'completed' : 'failed'
  }
}

// Get user-friendly end reason label
function getEndReasonLabel(code: string | null): string {
  if (!code) return 'Call ended'
  return END_REASON_LABELS[code] || 'Call ended'
}

// Compute transcript confidence
function computeConfidence(transcriptions: Array<{ confidence: number | null }>): 'high' | 'medium' | 'low' {
  if (!transcriptions || transcriptions.length === 0) return 'low'

  const confidences = transcriptions
    .filter(t => t.confidence !== null)
    .map(t => t.confidence as number)

  if (confidences.length === 0) return 'medium'

  const avg = confidences.reduce((a, b) => a + b, 0) / confidences.length

  if (avg >= 0.85) return 'high'
  if (avg >= 0.65) return 'medium'
  return 'low'
}

interface AIExtraction {
  sentence: string
  takeaways: Array<{
    label: string
    value: string
    when?: string
    confidence: 'high' | 'medium' | 'low'
  }>
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Track whether we need to update recap_status on error
  let callId: string | null = null
  let serviceClient: ReturnType<typeof createClient> | null = null

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Missing authorization header')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      console.error('Missing env vars:', { supabaseUrl: !!supabaseUrl, supabaseAnonKey: !!supabaseAnonKey, supabaseServiceKey: !!supabaseServiceKey })
      throw new Error('Missing required environment variables')
    }

    const supabase = createClient(
      supabaseUrl,
      supabaseAnonKey,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      console.error('Auth error:', authError)
      throw new Error('Unauthorized')
    }

    let body
    try {
      body = await req.json()
    } catch (parseError) {
      console.error('JSON parse error:', parseError)
      throw new Error('Invalid JSON body')
    }

    callId = body.call_id
    const fetchOnly = body.fetch_only === true
    const isRetry = body.is_retry === true

    if (!callId) {
      throw new Error('call_id is required')
    }

    console.log('Processing call summary for call_id:', callId, { fetchOnly, isRetry })

    serviceClient = createClient(supabaseUrl, supabaseServiceKey)

    // Set status to pending immediately
    await serviceClient.from('calls').update({
      recap_status: 'recap_pending',
      recap_last_attempt_at: new Date().toISOString(),
      recap_attempt_count: isRetry
        ? serviceClient.rpc('increment_recap_attempt', { call_id_input: callId })
        : 1
    }).eq('id', callId)

    // Fetch all call data in parallel for speed
    console.log('Fetching call data...')
    const [callResult, contextResult, transcriptionsResult, eventsResult] = await Promise.all([
      serviceClient.from('calls').select('*').eq('id', callId).eq('user_id', user.id).single(),
      serviceClient.from('call_contexts').select('*, ivr_paths(*)').eq('call_id', callId).maybeSingle(),
      serviceClient.from('transcriptions').select('*').eq('call_id', callId).order('created_at', { ascending: true }),
      serviceClient.from('call_events').select('*').eq('call_id', callId).order('created_at', { ascending: true })
    ])

    if (callResult.error) {
      console.error('Call query error:', callResult.error)
      // Permanent failure - call doesn't exist or doesn't belong to user
      await serviceClient.from('calls').update({
        recap_status: 'recap_failed_permanent',
        recap_error_code: 'CALL_NOT_FOUND'
      }).eq('id', callId)
      throw new Error(`Call not found: ${callResult.error.message}`)
    }

    const call = callResult.data
    const context = contextResult.data
    const transcriptions = transcriptionsResult.data || []
    const events = eventsResult.data || []

    if (!call) {
      await serviceClient.from('calls').update({
        recap_status: 'recap_failed_permanent',
        recap_error_code: 'CALL_NOT_FOUND'
      }).eq('id', callId)
      throw new Error('Call not found')
    }

    console.log('Call data fetched:', { callId: call.id, transcriptionCount: transcriptions.length, eventCount: events.length })

    // Calculate call duration
    let durationSec: number | null = null
    if (call.started_at && call.ended_at) {
      durationSec = Math.round((new Date(call.ended_at).getTime() - new Date(call.started_at).getTime()) / 1000)
    }

    const wasAnswered = call.status === 'ended' && call.started_at !== null

    // Build transcript turns from ASR (them) and agent_speech events (our agent)
    const asrTurns = transcriptions.map(t => ({
      speaker: 'them' as const,
      text: t.content,
      timestamp: t.created_at,
      confidence: t.confidence
    }))

    const agentSpeechEvents = events.filter(e => e.event_type === 'agent_speech')
    const agentTurns = agentSpeechEvents.map(e => ({
      speaker: 'agent' as const,
      text: e.description || e.metadata?.text || '',
      timestamp: e.created_at,
      confidence: null as number | null
    }))

    const transcriptTurns = [...asrTurns, ...agentTurns]
      .filter(t => t.text && t.text.trim().length > 0)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    // Build debug timeline from events
    const debugTimeline = events.map(e => ({
      t: e.created_at,
      type: e.event_type,
      description: e.description || ''
    }))

    // Find the end reason from hangup event
    const hangupEvent = events.find(e => e.event_type === 'hangup')
    const endReasonCode = hangupEvent?.metadata?.reason as string || call.outcome || null

    // Get goal from call context
    const goal = context?.intent_purpose || null

    // Generate AI-powered outcome using GPT
    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    let aiExtraction: AIExtraction | null = null

    const hasConversation = transcriptTurns.length > 0

    // Check for permanent failure conditions
    if (!wasAnswered) {
      // Call didn't connect - this is a valid state, not a failure
      console.log('Call did not connect, generating non-connected recap')
    } else if (!hasConversation) {
      // Connected but no transcript - permanent failure
      await serviceClient.from('calls').update({
        recap_status: 'recap_failed_permanent',
        recap_error_code: 'NO_TRANSCRIPT'
      }).eq('id', callId)
      // Still return basic data
    }

    if (openaiKey && hasConversation && wasAnswered) {
      const transcriptText = transcriptTurns
        .map(t => `${t.speaker === 'agent' ? 'OneCalla' : 'Them'}: ${t.text}`)
        .join('\n')

      // ============================================================================
      // IMPROVED PROMPT FOR HIGH-QUALITY OUTCOME SENTENCES
      // ============================================================================
      const systemPrompt = `You are analyzing a phone call transcript for OneCalla, a phone calling assistant.

Your task is to generate a HIGH-QUALITY recap that answers the user's goal clearly.

## OUTPUT REQUIREMENTS

### 1. Outcome Sentence (CRITICAL)
- MUST be a complete, meaningful sentence
- MUST directly address what the user wanted to know
- MUST use EXACT values from the transcript (times, dates, names, amounts)
- If the goal was to learn a time: "Sarah said she will be home around 1:00 p.m."
- If date is ambiguous, say so: "Sarah said around 1:00 p.m., but it was unclear if she meant today or tomorrow."
- NEVER output: "Call ended", "Key mention: X", or any placeholder like "00"
- NEVER invent information not in the transcript

### 2. Takeaways (max 2)
Only include if they add value beyond the outcome sentence:
- "Time mentioned: 1:00 p.m." (only if outcome doesn't already say it clearly)
- "Date clarity: unclear" (only if there's actual ambiguity)

### 3. Confidence
- high: Clear, unambiguous answer to the goal
- medium: Answer exists but with hedges ("around", "probably", "maybe")
- low: Unclear, conflicting, or partial information

## PARSING RULES
- "1 pm", "1:00 p.m.", "1 o'clock" → extract as "1:00 p.m."
- "tomorrow", "today", "tonight" → include in the sentence
- If transcript says "I'll be home by 1" → output "1:00 p.m." (assume PM for afternoon context)

## EXAMPLE OUTPUTS

Good: "Sarah said she will be home tomorrow around 1:00 p.m."
Bad: "Call ended. Key mention: 1."

Good: "The appointment is confirmed for Monday at 3:30 p.m."
Bad: "Appointment mentioned."

Good: "John said he's not sure but probably around 5 or 6 in the evening."
Bad: "Time: 00 (uncertain)"

Respond with JSON only:
{
  "sentence": "Full, meaningful outcome sentence with exact values",
  "takeaways": []
}`

      const userPrompt = `Call goal: ${goal || 'General call'}

Transcript:
${transcriptText}

Generate the outcome sentence and takeaways. Remember:
- Use EXACT values from the transcript
- The sentence must directly answer the goal
- Never use placeholder values`

      try {
        console.log('Calling OpenAI for summary extraction...')
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.2, // Lower temperature for more deterministic output
            max_tokens: 500,
            response_format: { type: 'json_object' }
          }),
        })

        if (response.ok) {
          const data = await response.json()
          const content = data.choices?.[0]?.message?.content
          if (content) {
            try {
              aiExtraction = JSON.parse(content)
              console.log('AI extraction succeeded:', aiExtraction?.sentence?.slice(0, 50))
            } catch (jsonError) {
              console.error('Failed to parse AI response:', content)
              // Transient failure - AI returned invalid JSON
              await serviceClient.from('calls').update({
                recap_status: 'recap_failed_transient',
                recap_error_code: 'AI_PARSE_ERROR'
              }).eq('id', callId)
              throw new Error('AI returned invalid response')
            }
          }
        } else {
          const errorText = await response.text()
          console.error('OpenAI API error:', response.status, errorText)

          // Check if it's a rate limit or temporary error
          if (response.status === 429 || response.status >= 500) {
            await serviceClient.from('calls').update({
              recap_status: 'recap_failed_transient',
              recap_error_code: response.status === 429 ? 'RATE_LIMIT' : 'AI_SERVER_ERROR'
            }).eq('id', callId)
            throw new Error(`AI service temporarily unavailable: ${response.status}`)
          } else {
            // Other errors (400, 401, etc.) are likely permanent
            await serviceClient.from('calls').update({
              recap_status: 'recap_failed_transient', // Still allow retry
              recap_error_code: 'AI_API_ERROR'
            }).eq('id', callId)
            throw new Error(`AI API error: ${response.status}`)
          }
        }
      } catch (aiError) {
        if ((aiError as Error).message.includes('AI')) {
          throw aiError // Re-throw AI errors
        }
        console.error('AI extraction network error:', aiError)
        await serviceClient.from('calls').update({
          recap_status: 'recap_failed_transient',
          recap_error_code: 'NETWORK_ERROR'
        }).eq('id', callId)
        throw new Error('Network error during AI extraction')
      }
    }

    // Build outcome object
    let outcome = null
    const status = mapOutcomeToStatus(call.outcome, wasAnswered)

    if (wasAnswered && hasConversation) {
      // Generate fallback sentence if AI failed
      let sentence = aiExtraction?.sentence || ''
      if (!sentence) {
        // Build a basic sentence from transcript
        const theirResponses = transcriptTurns.filter(t => t.speaker === 'them')
        if (theirResponses.length > 0) {
          const lastResponse = theirResponses[theirResponses.length - 1].text
          sentence = `The call connected and they responded: "${lastResponse.slice(0, 100)}${lastResponse.length > 100 ? '...' : ''}"`
        } else {
          sentence = `Call connected for ${formatDuration(durationSec)}.`
        }
      }

      // Validate sentence quality - must be meaningful
      if (sentence.length < 15 || sentence.match(/^(call ended|key mention)/i)) {
        // Fallback to transcript-based sentence
        const theirResponses = transcriptTurns.filter(t => t.speaker === 'them')
        if (theirResponses.length > 0) {
          const combined = theirResponses.map(t => t.text).join(' ').slice(0, 150)
          sentence = `They said: "${combined}${combined.length >= 150 ? '...' : ''}"`
        }
      }

      outcome = {
        sentence,
        takeaways: aiExtraction?.takeaways || [],
        confidence: computeConfidence(transcriptions),
        warnings: [] as string[]
      }

      // Add warning if low confidence
      if (outcome.confidence === 'low') {
        outcome.warnings.push('Some details may be uncertain. Check the transcript.')
      }
    } else if (wasAnswered && !hasConversation) {
      // Connected but no transcript
      outcome = {
        sentence: `Call connected for ${formatDuration(durationSec)} but no conversation was captured.`,
        takeaways: [],
        confidence: 'low' as const,
        warnings: ['Transcript not available for this call.']
      }
    } else {
      // Call didn't connect
      const statusMessages: Record<string, string> = {
        'no_answer': `No answer from ${call.phone_number}.`,
        'busy': `The line was busy.`,
        'voicemail': `Reached voicemail.`,
        'failed': `Call couldn't connect.`,
        'canceled': `Call was cancelled.`
      }
      outcome = {
        sentence: statusMessages[status] || `Call to ${call.phone_number} didn't connect.`,
        takeaways: [],
        confidence: 'high' as const,
        warnings: []
      }
    }

    // Build the full CallCardData object
    const callCardData = {
      callId: call.id,
      contact: {
        name: context?.company_name || null,
        phone: call.phone_number
      },
      createdAt: call.created_at,
      startedAt: call.started_at,
      connectedAt: call.started_at,
      endedAt: call.ended_at,
      durationSec,
      status,
      endReason: endReasonCode ? {
        label: getEndReasonLabel(endReasonCode),
        code: endReasonCode
      } : null,
      goal,
      outcome,
      transcript: {
        turns: transcriptTurns,
        hasFullTranscript: hasConversation
      },
      media: {
        hasRecording: false,
        recordingUrl: null
      },
      debug: {
        timeline: debugTimeline,
        provider: {
          name: 'Telnyx',
          callControlId: call.telnyx_call_id
        },
        endReasonCode
      }
    }

    // Update call record with recap_ready status and summary
    await serviceClient.from('calls').update({
      recap_status: 'recap_ready',
      recap_error_code: null,
      summary: outcome?.sentence || null
    }).eq('id', callId)

    // Store the summary as an assistant message (for backward compatibility)
    if (outcome?.sentence) {
      await serviceClient.from('messages').insert({
        user_id: user.id,
        role: 'assistant',
        content: outcome.sentence,
        call_id: callId,
      })
    }

    console.log('Call summary completed successfully for call_id:', callId)

    return new Response(JSON.stringify({
      callCardData,
      summary: outcome?.sentence
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Call summary error:', error)

    // If we haven't already set a failure status, set transient failure
    if (callId && serviceClient) {
      try {
        const { data: currentCall } = await serviceClient
          .from('calls')
          .select('recap_status')
          .eq('id', callId)
          .single()

        // Only update if still in pending state (not already set to a failure)
        if (currentCall?.recap_status === 'recap_pending') {
          await serviceClient.from('calls').update({
            recap_status: 'recap_failed_transient',
            recap_error_code: 'UNKNOWN_ERROR'
          }).eq('id', callId)
        }
      } catch (updateError) {
        console.error('Failed to update recap status on error:', updateError)
      }
    }

    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds < 1) return 'a few seconds'
  if (seconds < 60) return `${seconds} seconds`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (secs === 0) return `${mins} minute${mins !== 1 ? 's' : ''}`
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

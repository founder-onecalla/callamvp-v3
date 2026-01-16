import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

    const { call_id } = await req.json()
    if (!call_id) {
      throw new Error('call_id is required')
    }

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Fetch all call data in parallel for speed
    const [callResult, contextResult, transcriptionsResult, eventsResult] = await Promise.all([
      serviceClient.from('calls').select('*').eq('id', call_id).eq('user_id', user.id).single(),
      serviceClient.from('call_contexts').select('*, ivr_paths(*)').eq('call_id', call_id).maybeSingle(),
      serviceClient.from('transcriptions').select('*').eq('call_id', call_id).order('created_at', { ascending: true }),
      serviceClient.from('call_events').select('*').eq('call_id', call_id).order('created_at', { ascending: true })
    ])

    const call = callResult.data
    const context = contextResult.data
    const transcriptions = transcriptionsResult.data || []
    const events = eventsResult.data || []

    if (callResult.error || !call) {
      throw new Error('Call not found')
    }

    // Calculate call duration
    let durationSec: number | null = null
    if (call.started_at && call.ended_at) {
      durationSec = Math.round((new Date(call.ended_at).getTime() - new Date(call.started_at).getTime()) / 1000)
    }

    const wasAnswered = call.status === 'ended' && call.started_at !== null

    // Build transcript turns from ASR (them) and agent_speech events (our agent)
    // 1. ASR transcriptions - what "them" said
    const asrTurns = transcriptions.map(t => ({
      speaker: 'them' as const,
      text: t.content,
      timestamp: t.created_at,
      confidence: t.confidence
    }))

    // 2. Agent speech events - what our agent said (TTS text)
    const agentSpeechEvents = events.filter(e => e.event_type === 'agent_speech')
    const agentTurns = agentSpeechEvents.map(e => ({
      speaker: 'agent' as const,
      text: e.description || e.metadata?.text || '',
      timestamp: e.created_at,
      confidence: null as number | null
    }))

    // 3. Merge and sort chronologically
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
    if (openaiKey && hasConversation) {
      const transcriptText = transcriptTurns
        .map(t => `${t.speaker === 'agent' ? 'OneCalla' : 'Them'}: ${t.text}`)
        .join('\n')

      const systemPrompt = `You are analyzing a phone call transcript for OneCalla, a phone calling assistant.

Extract two things:
1. A one-sentence summary of what happened (conversational, like telling a friend)
2. Key takeaways as structured data (max 3 items)

CRITICAL RULES:
- ONLY use information explicitly in the transcript
- NEVER invent details not present
- If nothing notable was learned, return an empty takeaways array
- Be specific with values extracted (times, dates, names, amounts)

Respond with JSON only:
{
  "sentence": "One sentence summary here",
  "takeaways": [
    {
      "label": "What this info is about",
      "value": "The extracted value",
      "when": "Time qualifier if applicable (optional)",
      "confidence": "high" | "medium" | "low"
    }
  ]
}

Confidence rules:
- high: Clear, unambiguous statement
- medium: Has hedges ("around", "about", "maybe") or partial info
- low: Unclear, conflicting info, or low audio quality indicated`

      const userPrompt = `Call purpose: ${goal || 'General call'}

Transcript:
${transcriptText}

Extract the summary and any key takeaways from this call.`

      try {
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
            temperature: 0.3,
            max_tokens: 500,
            response_format: { type: 'json_object' }
          }),
        })

        if (response.ok) {
          const data = await response.json()
          aiExtraction = JSON.parse(data.choices[0].message.content)
        }
      } catch (aiError) {
        console.error('AI extraction error:', aiError)
      }
    }

    // Build outcome object
    let outcome = null
    const status = mapOutcomeToStatus(call.outcome, wasAnswered)

    if (wasAnswered) {
      // Generate fallback sentence if AI failed
      let sentence = aiExtraction?.sentence || ''
      if (!sentence) {
        if (hasConversation) {
          sentence = `Call connected for ${formatDuration(durationSec)}.`
        } else {
          sentence = `Call connected for ${formatDuration(durationSec)} but transcript wasn't captured.`
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
    } else {
      // Call didn't connect
      const statusMessages: Record<string, string> = {
        'no_answer': `No answer from ${call.phone_number}.`,
        'busy': `Line was busy.`,
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
      connectedAt: call.started_at, // In our model, started_at is when connected
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
        hasRecording: false, // We don't have recording yet
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

    // Store the summary as an assistant message (for backward compatibility)
    if (outcome?.sentence) {
      await serviceClient.from('messages').insert({
        user_id: user.id,
        role: 'assistant',
        content: outcome.sentence,
        call_id: call_id,
      })
    }

    // Also update the call record with the summary
    await serviceClient.from('calls').update({
      summary: outcome?.sentence || null
    }).eq('id', call_id)

    return new Response(JSON.stringify({
      callCardData,
      // Keep summary for backward compatibility
      summary: outcome?.sentence
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Call summary error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
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

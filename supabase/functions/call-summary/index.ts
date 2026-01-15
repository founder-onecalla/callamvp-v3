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
    const transcriptions = transcriptionsResult.data
    const events = eventsResult.data

    if (callResult.error || !call) {
      throw new Error('Call not found')
    }

    // Calculate call duration
    let duration = 0
    if (call.started_at && call.ended_at) {
      duration = Math.round((new Date(call.ended_at).getTime() - new Date(call.started_at).getTime()) / 1000)
    }

    // Build context for GPT
    const wasAnswered = call.status === 'ended' && call.started_at !== null
    const hasTranscriptions = transcriptions && transcriptions.length > 0

    let transcriptText = 'No transcription available.'
    if (hasTranscriptions) {
      transcriptText = transcriptions
        .map(t => `${t.speaker === 'user' ? 'You' : 'Them'}: ${t.content}`)
        .join('\n')
    }

    let eventsText = ''
    if (events && events.length > 0) {
      eventsText = events.map(e => `- ${e.event_type}: ${e.description || ''}`).join('\n')
    }

    const contextInfo = context ? `
Call Purpose: ${context.intent_purpose || 'General call'}
Company: ${context.company_name || 'Unknown'}
Category: ${context.intent_category || 'Unknown'}
User's Goal: ${JSON.stringify(context.gathered_info || {})}
` : 'No pre-call context available.'

    const systemPrompt = `You are generating a post-call summary for OneCalla, a phone calling assistant.

## CRITICAL: ONLY STATE FACTS FROM THE DATA PROVIDED
- ONLY report what is explicitly in the transcript or call events
- If there is no transcript, you can ONLY state basic facts: connected/didn't connect, duration, outcome
- NEVER invent names, conversations, or outcomes that aren't in the data
- If you don't know what was discussed, say "Call connected but no transcript was captured" or similar
- NEVER claim a voicemail was left unless the transcript shows it

Your summary should:
- Be conversational and natural, like a friend telling them what happened
- Be concise (2-4 sentences typically, maybe more if a lot happened)
- Focus on what matters: did it connect? what was discussed? was the goal achieved?
- Include specific details mentioned (names, times, amounts, next steps) ONLY if they appear in the transcript
- Adapt tone to the call type (casual for personal, more detailed for business)

DO NOT:
- Use bullet points or formal formatting
- Start with "Here's your summary" or similar
- EVER make up details that aren't in the provided data
- Claim things happened if there's no transcript evidence

Examples of good summaries WITH transcript:
- "Got through to Xfinity. Spoke with Marcus who confirmed your internet will be back by tomorrow morning. He credited $15 to your account for the outage."
- "Booked! Table for 4 at 7pm Saturday. They said to text if you're running late."

Examples of good summaries WITHOUT transcript:
- "Call connected for 45 seconds but the transcript wasn't captured. You may want to try again."
- "Called but couldn't connect - the line was busy."
- "Call ended after 2 seconds. There may have been a technical issue."`

    const userPrompt = `Generate a post-call summary based on this information:

CALL STATUS:
- Phone number: ${call.phone_number}
- Answered: ${wasAnswered ? 'Yes' : 'No'}
- Duration: ${duration > 0 ? `${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')}` : 'Did not connect'}
- Outcome: ${call.outcome || 'unknown'}

CONTEXT:
${contextInfo}

CALL EVENTS:
${eventsText || 'No events recorded'}

TRANSCRIPT (${hasTranscriptions ? transcriptions.length + ' messages' : 'NONE - no transcript captured'}):
${transcriptText}

IMPORTANT: ${hasTranscriptions ? 'Use the transcript above to describe what happened.' : 'There is NO transcript. Only state basic facts about whether the call connected and how long it lasted. Do NOT invent any conversation details.'}

Write a natural, conversational summary of what happened on this call.`

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
        model: 'gpt-4o', // Faster than gpt-4-turbo
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 300,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI API error: ${error}`)
    }

    const data = await response.json()
    const summary = data.choices[0].message.content

    // Store the summary as an assistant message
    await serviceClient.from('messages').insert({
      user_id: user.id,
      role: 'assistant',
      content: summary,
      call_id: call_id,
    })

    return new Response(JSON.stringify({ summary }), {
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

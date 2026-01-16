import { useState, useEffect } from 'react'
import type { CallCardData, TranscriptTurn } from '../../lib/types'
import type { CallCardStatus } from '../../lib/types'
import type { SummaryState } from '../../hooks/useCall'

interface CallRecapCardProps {
  phoneNumber: string
  outcome: CallCardStatus
  duration: number | null
  endedAt: string | null
  transcriptTurns: TranscriptTurn[]
  callCardData: CallCardData | null
  summaryState: SummaryState
  summaryRequestedAt: number | null
  retryCount: number
  onRetry: () => void
  onExpand: () => void
}

// Compact status pill labels
const STATUS_PILL: Record<CallCardStatus, string> = {
  'completed': 'Ended',
  'no_answer': 'No answer',
  'busy': 'Busy',
  'voicemail': 'Voicemail',
  'failed': 'Failed',
  'canceled': 'Canceled',
  'in_progress': 'In progress',
}

function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

// ============================================================================
// DETERMINISTIC TRANSCRIPT-GROUNDED BASIC RECAP
// This MUST be grounded in the transcript and NEVER invent uncertainty
// ============================================================================

interface ExtractedInfo {
  times: { value: string; normalized: string; context: string }[]
  dates: { value: string; context: string }[]
  amounts: { value: string; context: string }[]
  confirmations: string[] // Direct quotes of confirmations
}

/**
 * Extract explicit information from transcript.
 * Only extracts what is CLEARLY stated - no inference.
 */
function extractFromTranscript(turns: TranscriptTurn[]): ExtractedInfo {
  const result: ExtractedInfo = {
    times: [],
    dates: [],
    amounts: [],
    confirmations: []
  }

  // Only look at what "them" said (the other party's responses)
  const theirTurns = turns.filter(t => t.speaker === 'them')
  const fullText = theirTurns.map(t => t.text).join(' ')

  // Time extraction - be EXACT
  // Matches: "1:00 p.m.", "1 pm", "7:30", "around 5", "by 1:00"
  const timeRegex = /\b(?:around\s+|by\s+|at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|AM|PM)?\b/gi
  let match
  while ((match = timeRegex.exec(fullText)) !== null) {
    const hour = match[1]
    const minutes = match[2] || '00'
    const period = match[3]?.toLowerCase().replace(/\./g, '') || ''

    // Skip if it's clearly not a time (like "1" by itself with no context)
    if (!period && !match[2] && !fullText.slice(Math.max(0, match.index - 10), match.index).match(/at|around|by/i)) {
      continue
    }

    // Normalize the time
    let normalized = `${hour}:${minutes}`
    if (period) {
      normalized += ` ${period}`
    }

    // Get surrounding context (20 chars before and after)
    const start = Math.max(0, match.index - 20)
    const end = Math.min(fullText.length, match.index + match[0].length + 20)
    const context = fullText.slice(start, end).trim()

    result.times.push({
      value: match[0].trim(),
      normalized,
      context
    })
  }

  // Date/day extraction
  const dayRegex = /\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\s+\w+)\b/gi
  while ((match = dayRegex.exec(fullText)) !== null) {
    const start = Math.max(0, match.index - 15)
    const end = Math.min(fullText.length, match.index + match[0].length + 15)
    result.dates.push({
      value: match[1],
      context: fullText.slice(start, end).trim()
    })
  }

  // Money extraction
  const moneyRegex = /(\$\d+(?:\.\d{2})?)/g
  while ((match = moneyRegex.exec(fullText)) !== null) {
    const start = Math.max(0, match.index - 15)
    const end = Math.min(fullText.length, match.index + match[0].length + 15)
    result.amounts.push({
      value: match[1],
      context: fullText.slice(start, end).trim()
    })
  }

  // Look for confirmations/acknowledgments
  const confirmRegex = /\b(yes|yeah|sure|okay|ok|that's right|correct|will do|got it)\b/gi
  while ((match = confirmRegex.exec(fullText)) !== null) {
    result.confirmations.push(match[1])
  }

  return result
}

interface BasicRecap {
  outcomeSentence: string
  evidence: string | null
  dateNote: string | null
  hasUncertainty: boolean
}

/**
 * Build a deterministic basic recap from transcript.
 * Rules:
 * 1. Use EXACT values from transcript - never show "00" if transcript says "1:00 p.m."
 * 2. Only claim uncertainty if transcript truly has multiple conflicting values
 * 3. Evidence must be a direct quote from transcript
 */
function buildTranscriptGroundedRecap(
  outcome: CallCardStatus,
  extracted: ExtractedInfo,
  hasTranscript: boolean
): BasicRecap {
  // Handle non-connected outcomes
  if (outcome === 'no_answer') {
    return {
      outcomeSentence: 'No one answered the call.',
      evidence: null,
      dateNote: 'You may want to try calling again later.',
      hasUncertainty: false
    }
  }
  if (outcome === 'busy') {
    return {
      outcomeSentence: 'The line was busy.',
      evidence: null,
      dateNote: 'Try calling back in a few minutes.',
      hasUncertainty: false
    }
  }
  if (outcome === 'voicemail') {
    return {
      outcomeSentence: 'Reached voicemail instead of a person.',
      evidence: null,
      dateNote: 'You may want to try calling again or wait for a callback.',
      hasUncertainty: false
    }
  }
  if (outcome === 'failed' || outcome === 'canceled') {
    return {
      outcomeSentence: 'The call did not connect.',
      evidence: null,
      dateNote: 'Please try again.',
      hasUncertainty: false
    }
  }

  // For completed calls - build from transcript data
  if (!hasTranscript) {
    return {
      outcomeSentence: 'The call connected but no transcript was captured.',
      evidence: null,
      dateNote: null,
      hasUncertainty: true
    }
  }

  // Build outcome sentence from extracted info
  const times = extracted.times
  const dates = extracted.dates

  // RULE: If we have exact times, use them EXACTLY
  if (times.length === 1) {
    // Single time mentioned - this is clear, use it
    const time = times[0]
    let sentence = `They said "${time.normalized}"`

    // Add date context if available
    if (dates.length > 0) {
      sentence += ` (${dates[0].value})`
    }
    sentence += '.'

    return {
      outcomeSentence: sentence,
      evidence: `"${time.context}"`,
      dateNote: dates.length === 0 ? 'The specific day was not mentioned.' : null,
      hasUncertainty: false
    }
  }

  if (times.length > 1) {
    // Multiple times - check if they're similar (range) or contradictory
    const timeValues = times.map(t => t.normalized)
    const sentence = `Multiple times were mentioned: ${timeValues.join(' and ')}.`

    return {
      outcomeSentence: sentence,
      evidence: `"${times[0].context}"`,
      dateNote: 'Review the transcript to confirm which time applies.',
      hasUncertainty: true
    }
  }

  // No times but call completed - check for other confirmations
  if (extracted.amounts.length > 0) {
    const amount = extracted.amounts[0]
    return {
      outcomeSentence: `An amount of ${amount.value} was mentioned.`,
      evidence: `"${amount.context}"`,
      dateNote: 'Review the transcript for full context.',
      hasUncertainty: false
    }
  }

  if (extracted.confirmations.length > 0) {
    return {
      outcomeSentence: 'The call connected and they responded.',
      evidence: null,
      dateNote: 'Review the transcript for details.',
      hasUncertainty: false
    }
  }

  // Transcript exists but no specific info extracted
  return {
    outcomeSentence: 'The call connected. Review the transcript for details.',
    evidence: null,
    dateNote: null,
    hasUncertainty: false
  }
}

// Skeleton for loading state
function SkeletonText({ width = 'w-full' }: { width?: string }) {
  return <div className={`h-4 bg-slate-200 rounded animate-pulse ${width}`} />
}

export default function CallRecapCard({
  phoneNumber,
  outcome,
  duration: _duration,
  endedAt,
  transcriptTurns,
  callCardData,
  summaryState,
  summaryRequestedAt,
  retryCount,
  onRetry,
  onExpand,
}: CallRecapCardProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [isRetrying, setIsRetrying] = useState(false)
  const [isOpening, setIsOpening] = useState(false)

  // Track elapsed time since summary request
  useEffect(() => {
    if (summaryState !== 'loading' || !summaryRequestedAt) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset is intentional when loading stops
      setElapsedSeconds(0)
      return
    }
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - summaryRequestedAt) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [summaryState, summaryRequestedAt])

  // Reset retrying state when summary state changes from loading
  useEffect(() => {
    if (summaryState !== 'loading') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset is intentional when loading stops
      setIsRetrying(false)
    }
  }, [summaryState])

  const hasTranscript = transcriptTurns.length > 0
  const statusPill = STATUS_PILL[outcome]

  // ============================================================================
  // STATE MODEL: Determine what recap data we have
  // ============================================================================
  const hasFullRecap = !!callCardData?.outcome?.sentence
  const extracted = extractFromTranscript(transcriptTurns)
  const basicRecap = buildTranscriptGroundedRecap(outcome, extracted, hasTranscript)
  const hasBasicRecapContent = basicRecap.outcomeSentence !== 'The call connected. Review the transcript for details.'

  // Determine UI state - NEVER show contradictory states
  const isLoading = summaryState === 'loading' && !isRetrying
  const isFullRecapFailed = summaryState === 'failed' && !hasFullRecap
  const isIdle = summaryState === 'idle' && !hasFullRecap

  // Get takeaways from full recap (max 2)
  const takeaways = callCardData?.outcome?.takeaways?.slice(0, 2) || []

  // Handle retry with state feedback
  const handleRetry = () => {
    setIsRetrying(true)
    onRetry()
  }

  // Handle open transcript with immediate feedback
  const handleOpenTranscript = () => {
    setIsOpening(true)
    setTimeout(() => {
      onExpand()
      setTimeout(() => setIsOpening(false), 500)
    }, 100)
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm max-w-sm">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Call recap</h3>
            <p className="text-xs text-slate-500">
              {phoneNumber}{endedAt && ` · ${formatTimestamp(endedAt)}`}
            </p>
          </div>
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
            {statusPill}
          </span>
        </div>
      </div>

      {/* Recap content */}
      <div className="px-4 py-3 border-b border-slate-100">

        {/* ================================================================
            STATE: Full recap available (AI-generated)
            ================================================================ */}
        {hasFullRecap && (
          <div className="space-y-2">
            <p className="text-sm text-slate-900 leading-relaxed">
              {callCardData!.outcome!.sentence}
            </p>
            {/* Takeaways from full recap */}
            {takeaways.length > 0 && (
              <div className="pt-2 border-t border-slate-100 space-y-1">
                {takeaways.map((t, i) => (
                  <p key={i} className="text-sm text-slate-600">
                    <span className="text-slate-400">{t.label}:</span>{' '}
                    <span className="font-medium">{t.value}</span>
                    {t.confidence === 'low' && (
                      <span className="text-orange-500 text-xs ml-1">(uncertain)</span>
                    )}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ================================================================
            STATE: Loading (generating full recap)
            ================================================================ */}
        {isLoading && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 border-2 border-slate-300 border-t-teal-500 rounded-full animate-spin" />
              <span className="text-sm text-slate-500">
                {elapsedSeconds < 15 ? 'Generating recap...' : 'Still working...'}
              </span>
            </div>
            {hasTranscript && elapsedSeconds >= 5 && (
              <p className="text-xs text-slate-400">Your transcript is saved and ready to view.</p>
            )}
          </div>
        )}

        {/* ================================================================
            STATE: Retrying
            ================================================================ */}
        {isRetrying && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 border-2 border-slate-300 border-t-teal-500 rounded-full animate-spin" />
            <span className="text-sm text-slate-500">Retrying...</span>
          </div>
        )}

        {/* ================================================================
            STATE: Full recap failed - Show basic recap WITHOUT contradiction
            Key rule: NEVER say "recap unavailable" while showing a recap
            ================================================================ */}
        {isFullRecapFailed && !isRetrying && (
          <div className="space-y-3">
            {/* Header for basic recap - NO "unavailable" message if we have content */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                {hasBasicRecapContent ? 'Basic recap' : 'Transcript summary'}
              </span>
              <button
                onClick={handleRetry}
                disabled={isRetrying}
                className="text-xs font-medium text-teal-600 hover:text-teal-700 active:text-teal-800 transition-colors disabled:opacity-50"
              >
                {retryCount >= 2 ? 'Try full recap again' : 'Get full recap'}
              </button>
            </div>

            {/* Only show this note if we have NO basic recap content */}
            {!hasBasicRecapContent && !hasTranscript && (
              <p className="text-sm text-slate-500">
                Transcript not available. Please try calling again.
              </p>
            )}

            {/* Basic recap content - transcript-grounded */}
            {(hasBasicRecapContent || hasTranscript) && (
              <div className="space-y-2">
                {/* Main outcome sentence */}
                <p className="text-sm text-slate-900 leading-relaxed">
                  {basicRecap.outcomeSentence}
                </p>

                {/* Evidence quote - direct from transcript */}
                {basicRecap.evidence && (
                  <p className="text-xs text-slate-500 italic pl-3 border-l-2 border-slate-200">
                    {basicRecap.evidence}
                  </p>
                )}

                {/* Date/context note */}
                {basicRecap.dateNote && (
                  <p className="text-xs text-slate-500">
                    {basicRecap.dateNote}
                  </p>
                )}
              </div>
            )}

            {/* Retry message if multiple failed attempts */}
            {retryCount >= 2 && (
              <p className="text-xs text-slate-400 bg-slate-50 rounded px-2 py-1">
                Full recap is temporarily unavailable. Basic recap shown above.
              </p>
            )}
          </div>
        )}

        {/* ================================================================
            STATE: Idle (waiting for summary to start)
            ================================================================ */}
        {isIdle && (
          <div className="space-y-2">
            <SkeletonText width="w-full" />
            <SkeletonText width="w-2/3" />
            {hasTranscript && (
              <p className="text-xs text-slate-400 mt-2">Transcript is ready while we generate the recap.</p>
            )}
          </div>
        )}
      </div>

      {/* Action - Open transcript */}
      {hasTranscript && (
        <div className="px-4 py-3">
          <button
            onClick={handleOpenTranscript}
            disabled={isOpening}
            className={`w-full py-2.5 text-sm font-medium rounded-lg transition-colors ${
              isOpening
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'text-teal-600 hover:text-teal-700 hover:bg-teal-50 active:bg-teal-100'
            }`}
          >
            {isOpening ? 'Opening...' : 'Open transcript'}
          </button>
        </div>
      )}

      {/* Fallback when no transcript */}
      {!hasTranscript && (
        <div className="px-4 py-3 text-center">
          <p className="text-xs text-slate-400">No transcript available for this call.</p>
        </div>
      )}
    </div>
  )
}

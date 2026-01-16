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
  summaryError: string | null
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

// Extract structured mentions from transcript
interface ExtractedMention {
  type: 'time' | 'relative_time' | 'money' | 'number'
  value: string
  context: string // surrounding words for evidence
}

function extractMentions(turns: TranscriptTurn[]): ExtractedMention[] {
  const mentions: ExtractedMention[] = []
  const seen = new Set<string>()

  // Only look at what "them" said (the other party)
  const theirTurns = turns.filter(t => t.speaker === 'them')

  for (const turn of theirTurns) {
    const text = turn.text

    // Time patterns (e.g., "2 pm", "7:30", "around 5")
    const timeRegex = /(.{0,20})\b(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM|a\.m\.|p\.m\.)?)\b(.{0,20})/g
    let match
    while ((match = timeRegex.exec(text)) !== null) {
      const value = match[2].trim()
      if (!seen.has(value.toLowerCase())) {
        seen.add(value.toLowerCase())
        mentions.push({
          type: 'time',
          value,
          context: (match[1] + match[2] + match[3]).trim()
        })
      }
    }

    // Relative time (e.g., "tomorrow", "next week")
    const relativeRegex = /(.{0,15})\b(tomorrow|today|tonight|next\s+\w+|in\s+\d+\s+(?:minutes?|hours?|days?))\b(.{0,15})/gi
    while ((match = relativeRegex.exec(text)) !== null) {
      const value = match[2].trim()
      if (!seen.has(value.toLowerCase())) {
        seen.add(value.toLowerCase())
        mentions.push({
          type: 'relative_time',
          value,
          context: (match[1] + match[2] + match[3]).trim()
        })
      }
    }

    // Money (e.g., "$50", "$100.00")
    const moneyRegex = /(.{0,15})(\$\d+(?:\.\d{2})?)(.{0,15})/g
    while ((match = moneyRegex.exec(text)) !== null) {
      const value = match[2]
      if (!seen.has(value)) {
        seen.add(value)
        mentions.push({
          type: 'money',
          value,
          context: (match[1] + match[2] + match[3]).trim()
        })
      }
    }
  }

  return mentions.slice(0, 3) // Max 3 mentions
}

// Build the 3-line Basic Recap
interface BasicRecap {
  lineA: string // Goal status
  lineB: string // Best available answer
  lineC: string // Next step
  evidence?: string // Optional quote
}

function buildBasicRecap(
  outcome: CallCardStatus,
  mentions: ExtractedMention[],
  hasTranscript: boolean
): BasicRecap {
  // Line A: Goal status based on outcome
  let lineA: string
  switch (outcome) {
    case 'completed':
      if (mentions.length > 0) {
        lineA = 'Partially confirmed: the call connected but we could not generate a full recap.'
      } else {
        lineA = 'Could not confirm: the call connected but no specific information was captured.'
      }
      break
    case 'no_answer':
      lineA = 'Not confirmed: no one answered the call.'
      break
    case 'busy':
      lineA = 'Could not complete: the line was busy.'
      break
    case 'voicemail':
      lineA = 'Not confirmed: reached voicemail instead of a person.'
      break
    case 'failed':
      lineA = 'Could not complete: the call failed to connect.'
      break
    case 'canceled':
      lineA = 'Could not complete: the call was canceled before connecting.'
      break
    default:
      lineA = 'Could not confirm: call status unclear.'
  }

  // Line B: Best available answer with context
  let lineB: string
  let evidence: string | undefined

  if (mentions.length > 0) {
    const timeMentions = mentions.filter(m => m.type === 'time' || m.type === 'relative_time')
    const moneyMentions = mentions.filter(m => m.type === 'money')

    if (timeMentions.length > 0) {
      const times = timeMentions.map(m => `"${m.value}"`).join(' and ')
      if (timeMentions.length === 1) {
        lineB = `A time was mentioned (${times}), but it was unclear whether this refers to today, tomorrow, or another date.`
      } else {
        lineB = `Multiple times were mentioned (${times}), but the exact meaning was unclear. Please check the transcript.`
      }
      evidence = `"...${timeMentions[0].context}..."`
    } else if (moneyMentions.length > 0) {
      const amounts = moneyMentions.map(m => m.value).join(' and ')
      lineB = `An amount was mentioned (${amounts}), but the context was unclear. Please check the transcript.`
      evidence = `"...${moneyMentions[0].context}..."`
    } else {
      lineB = 'Some information may have been shared, but the context was unclear. Please check the transcript.'
    }
  } else if (hasTranscript) {
    lineB = 'The conversation was recorded, but no specific times, dates, or amounts were detected.'
  } else {
    lineB = 'No conversation was recorded for this call.'
  }

  // Line C: Next step
  let lineC: string
  if (outcome === 'no_answer' || outcome === 'busy' || outcome === 'failed') {
    lineC = 'Next step: try calling again later.'
  } else if (outcome === 'voicemail') {
    lineC = 'Next step: wait for a callback or try again later.'
  } else if (mentions.length > 0) {
    lineC = 'Next step: review the transcript to confirm the exact details.'
  } else if (hasTranscript) {
    lineC = 'Next step: review the transcript for any relevant information.'
  } else {
    lineC = 'Next step: consider calling again to get the information you need.'
  }

  return { lineA, lineB, lineC, evidence }
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
  summaryError: _summaryError,
  onRetry,
  onExpand,
}: CallRecapCardProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [isRetrying, setIsRetrying] = useState(false)
  const [isOpening, setIsOpening] = useState(false)

  // Track elapsed time since summary request
  useEffect(() => {
    if (summaryState !== 'loading' || !summaryRequestedAt) {
      setElapsedSeconds(0)
      return
    }
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - summaryRequestedAt) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [summaryState, summaryRequestedAt])

  // Reset retrying state when summary state changes
  useEffect(() => {
    if (summaryState !== 'loading') {
      setIsRetrying(false)
    }
  }, [summaryState])

  const hasTranscript = transcriptTurns.length > 0
  const statusPill = STATUS_PILL[outcome]

  // Get takeaways (max 2)
  const takeaways = callCardData?.outcome?.takeaways?.slice(0, 2) || []

  // Build basic recap from transcript
  const mentions = extractMentions(transcriptTurns)
  const basicRecap = buildBasicRecap(outcome, mentions, hasTranscript)

  // Handle retry with state feedback
  const handleRetry = () => {
    setIsRetrying(true)
    onRetry()
  }

  // Handle open transcript with immediate feedback
  const handleOpenTranscript = () => {
    setIsOpening(true)
    // Small delay to show the "Opening..." state before navigation
    setTimeout(() => {
      onExpand()
      // Reset after a brief moment (in case navigation doesn't unmount this)
      setTimeout(() => setIsOpening(false), 500)
    }, 100)
  }

  // Determine what recap to show
  const hasAIRecap = !!callCardData?.outcome?.sentence
  const showFallback = summaryState === 'failed' && !hasAIRecap
  const showLoading = summaryState === 'loading'
  const showIdle = summaryState === 'idle' && !hasAIRecap

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm max-w-sm">
      {/* Header - Clean and minimal */}
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
        {/* AI Recap (succeeded) */}
        {hasAIRecap && (
          <p className="text-sm text-slate-900 leading-relaxed">
            {callCardData.outcome!.sentence}
          </p>
        )}

        {/* Loading state */}
        {showLoading && !isRetrying && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 border-2 border-slate-300 border-t-teal-500 rounded-full animate-spin" />
            <span className="text-sm text-slate-500">
              {elapsedSeconds < 15 ? 'Generating recap...' : 'Still working...'}
            </span>
          </div>
        )}

        {/* Retrying state */}
        {isRetrying && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 border-2 border-slate-300 border-t-teal-500 rounded-full animate-spin" />
            <span className="text-sm text-slate-500">Retrying...</span>
          </div>
        )}

        {/* Basic Recap (3 lines) when AI failed */}
        {showFallback && !isRetrying && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">Basic recap</span>
              <button
                onClick={handleRetry}
                className="text-xs font-medium text-teal-600 hover:text-teal-700 active:text-teal-800 transition-colors"
              >
                Retry recap
              </button>
            </div>
            {/* Line A: Goal status */}
            <p className="text-sm text-slate-900 leading-relaxed">
              {basicRecap.lineA}
            </p>
            {/* Line B: Best available answer */}
            <p className="text-sm text-slate-700 leading-relaxed">
              {basicRecap.lineB}
            </p>
            {/* Evidence quote (if available) */}
            {basicRecap.evidence && (
              <p className="text-xs text-slate-500 italic pl-3 border-l-2 border-slate-200">
                Evidence: {basicRecap.evidence}
              </p>
            )}
            {/* Line C: Next step */}
            <p className="text-sm text-slate-600 leading-relaxed">
              {basicRecap.lineC}
            </p>
          </div>
        )}

        {/* Idle state (waiting for summary to start) */}
        {showIdle && (
          <div className="space-y-1">
            <SkeletonText width="w-full" />
            <SkeletonText width="w-2/3" />
          </div>
        )}

        {/* Takeaways - Only if available from AI, max 2 */}
        {takeaways.length > 0 && (
          <div className="mt-2 pt-2 border-t border-slate-100 space-y-1">
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

      {/* Single action - Open transcript */}
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
    </div>
  )
}

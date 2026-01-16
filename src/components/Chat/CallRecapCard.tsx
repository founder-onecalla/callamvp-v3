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

// Outcome descriptions for fallback
const OUTCOME_FALLBACK: Record<CallCardStatus, string> = {
  'completed': 'Call ended.',
  'no_answer': 'No answer.',
  'busy': 'Line was busy.',
  'voicemail': 'Reached voicemail.',
  'failed': 'Call failed to connect.',
  'canceled': 'Call was canceled.',
  'in_progress': 'Call in progress.',
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

// Extract key mentions from transcript for fallback recap
function extractKeyMentions(turns: TranscriptTurn[]): string[] {
  const mentions: string[] = []
  const seen = new Set<string>()

  // Only look at what "them" said (the other party)
  const theirText = turns
    .filter(t => t.speaker === 'them')
    .map(t => t.text)
    .join(' ')

  // Time patterns (e.g., "2 pm", "7:30", "around 5")
  const timeMatches = theirText.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?)\b/g)
  if (timeMatches) {
    for (const m of timeMatches.slice(0, 2)) {
      const normalized = m.toLowerCase().trim()
      if (!seen.has(normalized)) {
        seen.add(normalized)
        mentions.push(m.trim())
      }
    }
  }

  // Relative time (e.g., "tomorrow", "next week", "in 30 minutes")
  const relativeMatches = theirText.match(/\b(tomorrow|today|tonight|next\s+\w+|in\s+\d+\s+(?:minutes?|hours?|days?))\b/gi)
  if (relativeMatches) {
    for (const m of relativeMatches.slice(0, 2)) {
      const normalized = m.toLowerCase().trim()
      if (!seen.has(normalized)) {
        seen.add(normalized)
        mentions.push(m.trim())
      }
    }
  }

  // Money (e.g., "$50", "$100.00")
  const moneyMatches = theirText.match(/\$\d+(?:\.\d{2})?/g)
  if (moneyMatches) {
    for (const m of moneyMatches.slice(0, 2)) {
      if (!seen.has(m)) {
        seen.add(m)
        mentions.push(m)
      }
    }
  }

  return mentions.slice(0, 3) // Max 3 mentions
}

// Build fallback recap sentence
function buildFallbackRecap(outcome: CallCardStatus, mentions: string[], hasTranscript: boolean): string {
  const base = OUTCOME_FALLBACK[outcome]

  if (mentions.length > 0) {
    const mentionText = mentions.length === 1
      ? `Key mention: ${mentions[0]}`
      : `Key mentions: ${mentions.join(', ')}`
    return `${base} ${mentionText}.`
  }

  if (hasTranscript) {
    return `${base} Transcript is ready.`
  }

  return base
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

  // Build fallback recap from transcript
  const keyMentions = extractKeyMentions(transcriptTurns)
  const fallbackRecap = buildFallbackRecap(outcome, keyMentions, hasTranscript)

  // Handle retry with state feedback
  const handleRetry = () => {
    setIsRetrying(true)
    onRetry()
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

      {/* Outcome - Most important, first */}
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

        {/* Fallback recap (failed) */}
        {showFallback && !isRetrying && (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">Basic recap</span>
              <button
                onClick={handleRetry}
                className="text-xs font-medium text-teal-600 hover:text-teal-700 active:text-teal-800 transition-colors"
              >
                Retry
              </button>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed">
              {fallbackRecap}
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
            onClick={onExpand}
            className="w-full py-2 text-sm font-medium text-teal-600 hover:text-teal-700 hover:bg-teal-50 active:bg-teal-100 rounded-lg transition-colors"
          >
            Open transcript
          </button>
        </div>
      )}
    </div>
  )
}

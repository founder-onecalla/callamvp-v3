import { useState, useEffect } from 'react'
import type { CallCardData, TranscriptTurn } from '../../lib/types'
import { STATUS_LABELS, STATUS_COLORS, type CallCardStatus } from '../../lib/types'
import type { SummaryState } from '../../hooks/useCall'
import CallTranscriptView from './CallTranscriptView'

interface CallRecapCardProps {
  // Layer 1: Instant data (always available)
  phoneNumber: string
  outcome: CallCardStatus
  duration: number | null
  endedAt: string | null
  transcriptTurns: TranscriptTurn[]

  // Layer 2+: Summary data (may be loading/failed)
  callCardData: CallCardData | null
  summaryState: SummaryState
  summaryRequestedAt: number | null
  summaryError: string | null
  onRetry: () => void
  onExpand: () => void
}

// Call icon for artifact header
function CallIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
    </svg>
  )
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds < 1) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return 'Just now'
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

// Map internal status to user-friendly labels for Layer 1
function getOutcomeLabel(status: CallCardStatus): { label: string; description: string } {
  switch (status) {
    case 'completed':
      return { label: 'Completed', description: 'Call connected and ended normally' }
    case 'no_answer':
      return { label: 'No Answer', description: 'The call was not answered' }
    case 'busy':
      return { label: 'Busy', description: 'The line was busy' }
    case 'voicemail':
      return { label: 'Voicemail', description: 'Reached voicemail' }
    case 'failed':
      return { label: 'Failed', description: 'Call could not connect' }
    case 'canceled':
      return { label: 'Canceled', description: 'Call was canceled' }
    default:
      return { label: 'Ended', description: 'Call has ended' }
  }
}

// Skeleton placeholder component
function SkeletonLine({ width = 'w-full' }: { width?: string }) {
  return (
    <div className={`h-4 bg-slate-200 rounded animate-pulse ${width}`} />
  )
}

function SkeletonChip() {
  return (
    <div className="h-6 w-24 bg-slate-200 rounded-full animate-pulse" />
  )
}

// Extract potential answer candidates from transcript (Layer 1 raw extraction)
function extractRawAnswers(turns: TranscriptTurn[]): string[] {
  const answers: string[] = []
  const patterns = [
    /(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?)/g, // Times
    /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/g, // Dates
    /(tomorrow|today|tonight|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/gi,
    /(\$\d+(?:\.\d{2})?)/g, // Money
    /(\d+\s*(?:minutes?|hours?|days?|weeks?))/gi, // Durations
  ]

  for (const turn of turns) {
    if (turn.speaker === 'them') {
      for (const pattern of patterns) {
        const matches = turn.text.match(pattern)
        if (matches) {
          answers.push(...matches.slice(0, 2)) // Max 2 per pattern
        }
      }
    }
  }

  return [...new Set(answers)].slice(0, 3) // Dedupe, max 3
}

export default function CallRecapCard({
  phoneNumber,
  outcome,
  duration,
  endedAt,
  transcriptTurns,
  callCardData,
  summaryState,
  summaryRequestedAt,
  summaryError,
  onRetry,
  onExpand,
}: CallRecapCardProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  // Track elapsed time since summary request started
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

  const statusColors = STATUS_COLORS[outcome]
  const statusLabel = STATUS_LABELS[outcome]
  const outcomeInfo = getOutcomeLabel(outcome)

  // Get last 6 turns for preview
  const previewTurns = transcriptTurns.slice(-6)
  const hasTranscript = transcriptTurns.length > 0

  // Extract raw answer candidates (Layer 1)
  const rawAnswers = extractRawAnswers(transcriptTurns)

  // Determine status message based on elapsed time
  const getStatusMessage = () => {
    if (summaryState === 'succeeded') return null
    if (summaryState === 'failed') return null

    if (elapsedSeconds < 15) {
      return { text: 'Generating recap...', subtext: 'Based on transcript' }
    } else if (elapsedSeconds < 45) {
      return { text: 'Still working...', subtext: "You can keep browsing. We'll update automatically." }
    } else {
      return { text: 'Recap delayed', subtext: 'Transcript is ready now.' }
    }
  }

  const statusMessage = getStatusMessage()
  const showRetry = summaryState === 'failed' || (summaryState === 'loading' && elapsedSeconds >= 45)

  return (
    <div className="bg-slate-50 rounded-2xl border-2 border-slate-200 overflow-hidden shadow-sm">
      {/* Mode Header */}
      <div className="bg-slate-100 px-4 py-2 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-teal-500 flex items-center justify-center">
            <CallIcon className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-700">Call Complete</span>
              <span className="text-slate-400">·</span>
              <span className="text-sm text-slate-600 truncate">{phoneNumber}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Layer 1: Instant - Outcome, Duration, Timestamp (ALWAYS VISIBLE) */}
      <div className="px-4 py-3 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between mb-2">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusColors.bg} ${statusColors.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusColors.dot}`} />
            {statusLabel}
          </span>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            {duration !== null && duration > 0 && (
              <span className="font-mono">{formatDuration(duration)}</span>
            )}
            <span>{formatTimestamp(endedAt)}</span>
          </div>
        </div>
        <p className="text-sm text-slate-600">{outcomeInfo.description}</p>
      </div>

      {/* Layer 1: Raw answer candidates (if no summary yet) */}
      {!callCardData && rawAnswers.length > 0 && (
        <div className="px-4 py-2 bg-white border-b border-slate-200">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
            Mentioned in call
          </div>
          <div className="flex flex-wrap gap-2">
            {rawAnswers.map((answer, i) => (
              <span key={i} className="text-sm px-2 py-0.5 bg-slate-100 rounded text-slate-700">
                {answer}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Layer 2: Summary (loading/succeeded/failed) */}
      <div className="px-4 py-3 bg-white border-b border-slate-200">
        {/* Summary sentence */}
        {callCardData?.outcome?.sentence ? (
          <p className="text-sm text-slate-900 leading-relaxed">
            {callCardData.outcome.sentence}
          </p>
        ) : summaryState === 'loading' ? (
          <div className="space-y-2">
            <SkeletonLine width="w-full" />
            <SkeletonLine width="w-3/4" />
          </div>
        ) : summaryState === 'failed' ? (
          <p className="text-sm text-slate-500 italic">
            Recap unavailable right now
          </p>
        ) : null}

        {/* Takeaways */}
        {callCardData?.outcome?.takeaways && callCardData.outcome.takeaways.length > 0 ? (
          <div className="mt-3 space-y-1.5">
            {callCardData.outcome.takeaways.slice(0, 2).map((takeaway, index) => (
              <div key={index} className="flex items-baseline gap-2 text-sm">
                <span className="text-slate-500 flex-shrink-0">{takeaway.label}:</span>
                <span className="font-medium text-slate-900">{takeaway.value}</span>
                {takeaway.confidence === 'low' && (
                  <span className="text-orange-500 text-xs">?</span>
                )}
              </div>
            ))}
          </div>
        ) : summaryState === 'loading' ? (
          <div className="mt-3 flex gap-2">
            <SkeletonChip />
            <SkeletonChip />
          </div>
        ) : null}
      </div>

      {/* Status message (evolving) */}
      {statusMessage && (
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-2">
            {summaryState === 'loading' && elapsedSeconds < 45 && (
              <div className="w-4 h-4 border-2 border-slate-300 border-t-teal-500 rounded-full animate-spin" />
            )}
            <div>
              <span className="text-sm text-slate-600">{statusMessage.text}</span>
              {statusMessage.subtext && (
                <span className="text-xs text-slate-400 ml-2">{statusMessage.subtext}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Failure state */}
      {summaryState === 'failed' && (
        <div className="px-4 py-3 bg-orange-50 border-b border-slate-200">
          <p className="text-sm text-orange-700">
            {summaryError || 'Recap generation failed.'}
          </p>
          <p className="text-xs text-orange-600 mt-1">
            Transcript and call details are still available.
          </p>
        </div>
      )}

      {/* Layer 1: Transcript preview (ALWAYS VISIBLE if has transcript) */}
      {hasTranscript && (
        <div className="px-4 py-3 bg-white border-b border-slate-200">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
            Conversation preview
          </div>
          <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
            <CallTranscriptView
              turns={previewTurns}
              otherPartyName={phoneNumber}
              maxHeight="120px"
              isLive={false}
            />
          </div>
          {transcriptTurns.length > 6 && (
            <button
              onClick={onExpand}
              className="text-sm text-teal-600 hover:text-teal-700 mt-2"
            >
              View full transcript ({transcriptTurns.length} messages)
            </button>
          )}
        </div>
      )}

      {/* Actions - escape hatches */}
      <div className="px-4 py-3 bg-slate-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {showRetry && (
            <button
              onClick={onRetry}
              className="min-h-[36px] px-4 text-sm font-medium text-teal-600 hover:text-teal-700 hover:bg-teal-50 rounded-lg transition-colors"
            >
              {summaryState === 'failed' ? 'Retry recap' : 'Generate now'}
            </button>
          )}
        </div>
        <button
          onClick={onExpand}
          className="min-h-[36px] px-4 text-sm font-medium text-teal-600 hover:text-teal-700 hover:bg-teal-50 rounded-lg transition-colors"
        >
          View details
        </button>
      </div>
    </div>
  )
}

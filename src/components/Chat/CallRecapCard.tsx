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

// Skeleton for loading state
function SkeletonText({ width = 'w-full' }: { width?: string }) {
  return <div className={`h-4 bg-slate-200 rounded animate-pulse ${width}`} />
}

// Tiny transcript preview - just 2-4 turns
function TinyTranscriptPreview({ turns }: { turns: TranscriptTurn[] }) {
  const previewTurns = turns.slice(-4)

  if (previewTurns.length === 0) {
    return <p className="text-sm text-slate-400 italic">No conversation recorded</p>
  }

  return (
    <div className="space-y-1.5">
      {previewTurns.map((turn, i) => (
        <div key={i} className="flex gap-2 text-sm">
          <span className={`font-medium flex-shrink-0 ${
            turn.speaker === 'agent' ? 'text-teal-600' : 'text-slate-500'
          }`}>
            {turn.speaker === 'agent' ? 'OneCalla:' : 'Them:'}
          </span>
          <span className="text-slate-700 line-clamp-1">{turn.text}</span>
        </div>
      ))}
    </div>
  )
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

  const hasTranscript = transcriptTurns.length > 0
  const statusPill = STATUS_PILL[outcome]

  // Get takeaways (max 2)
  const takeaways = callCardData?.outcome?.takeaways?.slice(0, 2) || []

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
        {callCardData?.outcome?.sentence ? (
          <p className="text-sm text-slate-900 leading-relaxed">
            {callCardData.outcome.sentence}
          </p>
        ) : summaryState === 'loading' ? (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 border-2 border-slate-300 border-t-teal-500 rounded-full animate-spin" />
            <span className="text-sm text-slate-500">
              {elapsedSeconds < 15 ? 'Generating recap...' : 'Still working...'}
            </span>
          </div>
        ) : summaryState === 'failed' ? (
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">Recap unavailable right now</span>
            <button
              onClick={onRetry}
              className="text-sm font-medium text-teal-600 hover:text-teal-700"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            <SkeletonText width="w-full" />
            <SkeletonText width="w-2/3" />
          </div>
        )}

        {/* Takeaways - Only if available, max 2 */}
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

        {/* Transcript ready notice when recap failed/loading */}
        {(summaryState === 'failed' || (summaryState === 'loading' && elapsedSeconds >= 15)) && hasTranscript && (
          <p className="text-xs text-slate-400 mt-2">Transcript is ready.</p>
        )}
      </div>

      {/* Conversation preview - Tiny, 2-4 turns */}
      {hasTranscript && (
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
          <TinyTranscriptPreview turns={transcriptTurns} />
        </div>
      )}

      {/* Actions - Single row, clean */}
      <div className="px-4 py-2 flex items-center justify-between">
        {hasTranscript ? (
          <button
            onClick={onExpand}
            className="text-sm font-medium text-teal-600 hover:text-teal-700"
          >
            Open transcript
          </button>
        ) : (
          <span />
        )}
        <button
          onClick={onExpand}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          View details
        </button>
      </div>
    </div>
  )
}

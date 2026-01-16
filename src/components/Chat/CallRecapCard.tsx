import { useState, useEffect } from 'react'
import type { CallCardData, TranscriptTurn, RecapStatus, CallCardStatus, ConfidenceLevel } from '../../lib/types'

// ============================================================================
// CALL RECAP CARD - Pure function of recap status
// ============================================================================
// This component ONLY renders based on recapStatus. No local state overrides.
// The recap_status field from the call record is the single source of truth.
// ============================================================================

interface CallRecapCardProps {
  phoneNumber: string
  outcome: CallCardStatus
  duration: number | null
  endedAt: string | null
  transcriptTurns: TranscriptTurn[]
  // Single source of truth for recap state
  recapStatus: RecapStatus | null
  callCardData: CallCardData | null
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

// Confidence badge colors
const CONFIDENCE_STYLES: Record<ConfidenceLevel, { bg: string; text: string }> = {
  'high': { bg: 'bg-green-100', text: 'text-green-700' },
  'medium': { bg: 'bg-yellow-100', text: 'text-yellow-700' },
  'low': { bg: 'bg-orange-100', text: 'text-orange-700' },
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

// Spinner component
function Spinner() {
  return (
    <div className="w-4 h-4 border-2 border-slate-200 border-t-teal-500 rounded-full animate-spin" />
  )
}

export default function CallRecapCard({
  phoneNumber,
  outcome,
  duration: _duration,
  endedAt,
  transcriptTurns,
  recapStatus,
  callCardData,
  onRetry,
  onExpand,
}: CallRecapCardProps) {
  const [retryPending, setRetryPending] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  // Track elapsed time when pending
  useEffect(() => {
    if (recapStatus !== 'recap_pending') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset is intentional on status change
      setElapsedSeconds(0)
      setRetryPending(false)
      return
    }

    const startTime = Date.now()
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)

    return () => clearInterval(interval)
  }, [recapStatus])

  // Reset retry pending when status changes
  useEffect(() => {
    if (recapStatus !== 'recap_pending') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset is intentional on status change
      setRetryPending(false)
    }
  }, [recapStatus])

  const hasTranscript = transcriptTurns.length > 0
  const statusPill = STATUS_PILL[outcome]

  // Handle retry with immediate state feedback
  const handleRetry = () => {
    setRetryPending(true)
    onRetry()
  }

  // Get outcome data for display
  const outcomeData = callCardData?.outcome
  const takeaways = outcomeData?.takeaways?.slice(0, 2) || []

  // Find best evidence quote from transcript
  const getEvidenceQuote = (): string | null => {
    if (!hasTranscript) return null
    // Get the most informative line from their responses
    const theirTurns = transcriptTurns.filter(t => t.speaker === 'them')
    if (theirTurns.length === 0) return null
    // Find a turn with numbers or times
    const informativeTurn = theirTurns.find(t =>
      /\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)/i.test(t.text) ||
      /\b(tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(t.text)
    )
    if (informativeTurn) {
      return informativeTurn.text.length > 80
        ? informativeTurn.text.slice(0, 77) + '...'
        : informativeTurn.text
    }
    // Fallback to longest response
    const longest = theirTurns.reduce((a, b) => a.text.length > b.text.length ? a : b)
    return longest.text.length > 80 ? longest.text.slice(0, 77) + '...' : longest.text
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

      {/* Recap content - PURE FUNCTION OF recapStatus */}
      <div className="px-4 py-3 border-b border-slate-100">

        {/* ================================================================
            STATE: recap_ready - Show full recap content
            RULE: Only this state shows recap content
            ================================================================ */}
        {recapStatus === 'recap_ready' && outcomeData && (
          <div className="space-y-3">
            {/* Outcome header with confidence badge */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Outcome
              </span>
              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${CONFIDENCE_STYLES[outcomeData.confidence].bg} ${CONFIDENCE_STYLES[outcomeData.confidence].text}`}>
                {outcomeData.confidence === 'high' ? 'High' : outcomeData.confidence === 'medium' ? 'Medium' : 'Low'} confidence
              </span>
            </div>

            {/* Main outcome sentence - MUST be meaningful */}
            <p className="text-sm text-slate-900 leading-relaxed">
              {outcomeData.sentence}
            </p>

            {/* Key details (max 2 bullets) */}
            {takeaways.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  Key details
                </span>
                {takeaways.map((t, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-slate-400 mt-0.5">•</span>
                    <span>
                      <span className="text-slate-500">{t.label}:</span>{' '}
                      <span className="font-medium text-slate-900">{t.value}</span>
                      {t.confidence === 'low' && (
                        <span className="text-orange-500 text-xs ml-1">(unclear)</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Evidence quote */}
            {getEvidenceQuote() && (
              <div className="space-y-1">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  Evidence
                </span>
                <p className="text-xs text-slate-500 italic pl-3 border-l-2 border-slate-200">
                  "{getEvidenceQuote()}"
                </p>
              </div>
            )}

            {/* Next step - only if needed */}
            {outcomeData.confidence === 'low' && hasTranscript && (
              <div className="space-y-1">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  Next step
                </span>
                <p className="text-xs text-slate-600">
                  Open transcript to confirm the exact details.
                </p>
              </div>
            )}

            {/* Warnings */}
            {outcomeData.warnings.length > 0 && (
              <div className="text-xs text-orange-600 bg-orange-50 rounded px-2 py-1.5">
                {outcomeData.warnings[0]}
              </div>
            )}
          </div>
        )}

        {/* ================================================================
            STATE: recap_pending - Show spinner and progress
            ================================================================ */}
        {recapStatus === 'recap_pending' && (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Spinner />
              <span className="text-sm text-slate-600">
                Generating recap...
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {elapsedSeconds < 10
                ? 'This usually takes under 10 seconds.'
                : elapsedSeconds < 20
                ? 'Still working on it...'
                : 'Taking longer than usual...'}
            </p>
            {hasTranscript && elapsedSeconds >= 5 && (
              <p className="text-xs text-slate-400">
                Your transcript is already saved.
              </p>
            )}
          </div>
        )}

        {/* ================================================================
            STATE: recap_failed_transient - Can retry
            RULE: One compact error line + one retry button
            ================================================================ */}
        {recapStatus === 'recap_failed_transient' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-600">
                Recap failed to generate{hasTranscript ? ', transcript is saved.' : '.'}
              </p>
              <button
                onClick={handleRetry}
                disabled={retryPending}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  retryPending
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    : 'bg-teal-50 text-teal-600 hover:bg-teal-100 active:bg-teal-200'
                }`}
              >
                {retryPending ? (
                  <span className="flex items-center gap-2">
                    <Spinner />
                    Retrying...
                  </span>
                ) : (
                  'Retry recap'
                )}
              </button>
            </div>
          </div>
        )}

        {/* ================================================================
            STATE: recap_failed_permanent - No retry possible
            ================================================================ */}
        {recapStatus === 'recap_failed_permanent' && (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">
              Recap unavailable for this call{hasTranscript ? ', transcript is available.' : '.'}
            </p>
            {!hasTranscript && (
              <p className="text-xs text-slate-400">
                No transcript was captured during the call.
              </p>
            )}
          </div>
        )}

        {/* ================================================================
            STATE: null/undefined - Call hasn't ended yet or no state
            Show skeleton or nothing
            ================================================================ */}
        {!recapStatus && (
          <div className="space-y-2">
            <div className="h-4 bg-slate-100 rounded animate-pulse w-full" />
            <div className="h-4 bg-slate-100 rounded animate-pulse w-2/3" />
          </div>
        )}
      </div>

      {/* Action - Open transcript */}
      {hasTranscript && (
        <div className="px-4 py-3">
          <button
            onClick={onExpand}
            className="w-full py-2.5 text-sm font-medium rounded-lg text-teal-600 hover:text-teal-700 hover:bg-teal-50 active:bg-teal-100 transition-colors"
          >
            Open transcript
          </button>
        </div>
      )}

      {/* Fallback when no transcript */}
      {!hasTranscript && recapStatus && recapStatus !== 'recap_pending' && (
        <div className="px-4 py-3 text-center">
          <p className="text-xs text-slate-400">No transcript available.</p>
        </div>
      )}
    </div>
  )
}

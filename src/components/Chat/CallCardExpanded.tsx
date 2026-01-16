import type { CallCardData, ConfidenceLevel } from '../../lib/types'
import { STATUS_LABELS, STATUS_COLORS } from '../../lib/types'
import CallTranscriptView from './CallTranscriptView'
import TroubleshootingPanel from './TroubleshootingPanel'

interface CallCardExpandedProps {
  data: CallCardData
  onCollapse: () => void
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
  if (!seconds || seconds < 1) return '--:--'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

function ConfidenceIndicator({ level }: { level: ConfidenceLevel }) {
  const colors = {
    high: 'text-green-600 bg-green-100',
    medium: 'text-yellow-600 bg-yellow-100',
    low: 'text-orange-600 bg-orange-100'
  }

  const labels = {
    high: 'High confidence',
    medium: 'Medium confidence',
    low: 'Low confidence'
  }

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${colors[level]}`}>
      {labels[level]}
    </span>
  )
}

export default function CallCardExpanded({ data, onCollapse }: CallCardExpandedProps) {
  const statusColors = STATUS_COLORS[data.status]
  const statusLabel = STATUS_LABELS[data.status]
  const displayName = data.contact.name || data.contact.phone

  // Extract takeaway values for highlighting in transcript
  const highlightValues = data.outcome?.takeaways.map(t => t.value) || []

  return (
    // Call artifact container - distinct from chat
    <div className="bg-slate-50 rounded-2xl border-2 border-slate-200 overflow-hidden shadow-sm">
      {/* Mode Header - Call artifact identifier */}
      <div className="bg-slate-100 px-4 py-2 border-b border-slate-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-teal-500 flex items-center justify-center">
              <CallIcon className="w-3.5 h-3.5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-700">Call Complete</span>
                <span className="text-slate-400">·</span>
                <span className="text-sm text-slate-600">{displayName}</span>
              </div>
            </div>
          </div>
          <button
            onClick={onCollapse}
            className="min-w-[32px] min-h-[32px] flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
            title="Collapse"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div className="px-4 py-2 flex items-center gap-4 border-b border-slate-200 bg-white text-sm">
        <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${statusColors.bg} ${statusColors.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${statusColors.dot}`} />
          {statusLabel}
        </span>
        <span className="text-slate-500">{formatTimestamp(data.createdAt)}</span>
        {data.durationSec !== null && data.durationSec > 0 && (
          <span className="text-slate-500 font-mono">{formatDuration(data.durationSec)}</span>
        )}
        {data.endReason && (
          <span className="text-slate-500">{data.endReason.label}</span>
        )}
      </div>

      {/* Summary Section */}
      <div className="px-4 py-3 bg-white border-b border-slate-200 space-y-3">
        {/* Goal */}
        {data.goal && (
          <div>
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
              Call Goal
            </div>
            <p className="text-sm text-slate-700">{data.goal}</p>
          </div>
        )}

        {/* Outcome */}
        {data.outcome && (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                Outcome
              </span>
              <ConfidenceIndicator level={data.outcome.confidence} />
            </div>
            <p className="text-sm text-slate-900 leading-relaxed">
              {data.outcome.sentence}
            </p>
          </div>
        )}
      </div>

      {/* Warnings */}
      {data.outcome?.warnings && data.outcome.warnings.length > 0 && (
        <div className="px-4 py-3 bg-white border-b border-slate-200">
          <div className="text-xs text-orange-600 bg-orange-50 rounded-lg px-3 py-2">
            {data.outcome.warnings.map((warning, i) => (
              <p key={i}>{warning}</p>
            ))}
          </div>
        </div>
      )}

      {/* Key Takeaways */}
      {data.outcome?.takeaways && data.outcome.takeaways.length > 0 && (
        <div className="px-4 py-3 bg-white border-b border-slate-200">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
            Key Takeaways
          </div>
          <div className="space-y-2">
            {data.outcome.takeaways.map((takeaway, index) => (
              <div key={index} className="flex items-start gap-2 text-sm bg-slate-50 rounded-lg px-3 py-2">
                <span className="text-slate-500 flex-shrink-0">{takeaway.label}:</span>
                <div className="flex-1">
                  <span className="font-medium text-slate-900">{takeaway.value}</span>
                  {takeaway.when && (
                    <span className="text-slate-500 ml-1">({takeaway.when})</span>
                  )}
                  {takeaway.confidence === 'low' && (
                    <span className="text-orange-500 text-xs ml-2" title="Low confidence">
                      Uncertain
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Conversation - using call mode transcript view */}
      <div className="px-4 py-3 bg-white border-b border-slate-200">
        <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
          Conversation
        </div>
        {data.transcript.turns.length > 0 ? (
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
            <CallTranscriptView
              turns={data.transcript.turns}
              otherPartyName={displayName}
              highlightValues={highlightValues}
              maxHeight="200px"
              isLive={false}
            />
          </div>
        ) : (
          <div className="text-sm text-slate-500 text-center py-4 bg-slate-50 rounded-xl">
            No transcript available
          </div>
        )}
      </div>

      {/* Troubleshooting Panel */}
      <div className="px-4 py-3 bg-white border-b border-slate-200">
        <TroubleshootingPanel
          timeline={data.debug.timeline}
          endReason={data.endReason}
          provider={data.debug.provider}
        />
      </div>

      {/* Actions */}
      <div className="px-4 py-3 bg-slate-50 flex items-center justify-between">
        <button
          onClick={() => {
            if (data.outcome?.sentence) {
              navigator.clipboard.writeText(data.outcome.sentence)
            }
          }}
          className="min-h-[36px] px-4 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
        >
          Copy summary
        </button>

        <button
          onClick={onCollapse}
          className="min-h-[36px] px-4 text-sm font-medium text-teal-600 hover:text-teal-700 hover:bg-teal-50 rounded-lg transition-colors"
        >
          Collapse
        </button>
      </div>
    </div>
  )
}

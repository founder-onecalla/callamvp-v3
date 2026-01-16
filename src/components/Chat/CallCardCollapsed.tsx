import type { CallCardData } from '../../lib/types'
import { STATUS_LABELS, STATUS_COLORS } from '../../lib/types'

interface CallCardCollapsedProps {
  data: CallCardData
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
  if (!seconds || seconds < 1) return '--:--'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  } else if (days === 1) {
    return 'Yesterday'
  } else if (days < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short' })
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
}

export default function CallCardCollapsed({ data, onExpand }: CallCardCollapsedProps) {
  const statusColors = STATUS_COLORS[data.status]
  const statusLabel = STATUS_LABELS[data.status]
  const displayName = data.contact.name || data.contact.phone

  // Show max 2 takeaways
  const visibleTakeaways = data.outcome?.takeaways.slice(0, 2) || []
  const hiddenCount = (data.outcome?.takeaways.length || 0) - visibleTakeaways.length

  return (
    // Call artifact container - distinct from chat
    <div className="bg-slate-50 rounded-2xl border-2 border-slate-200 overflow-hidden shadow-sm">
      {/* Mode Header - Call artifact identifier */}
      <div className="bg-slate-100 px-4 py-2 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-teal-500 flex items-center justify-center">
            <CallIcon className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-700">Call Complete</span>
              <span className="text-slate-400">·</span>
              <span className="text-sm text-slate-600 truncate">{displayName}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-500 flex-shrink-0">
            <span>{formatTimestamp(data.createdAt)}</span>
            {data.durationSec !== null && data.durationSec > 0 && (
              <span className="font-mono">{formatDuration(data.durationSec)}</span>
            )}
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="px-4 py-2 bg-white border-b border-slate-200">
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${statusColors.bg} ${statusColors.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${statusColors.dot}`} />
          {statusLabel}
        </span>
      </div>

      {/* Outcome sentence */}
      {data.outcome?.sentence && (
        <div className="px-4 py-3 bg-white border-b border-slate-200">
          <p className="text-sm text-slate-700 leading-relaxed">
            {data.outcome.sentence}
          </p>
        </div>
      )}

      {/* Takeaways */}
      {visibleTakeaways.length > 0 && (
        <div className="px-4 py-3 bg-white border-b border-slate-200 space-y-1.5">
          {visibleTakeaways.map((takeaway, index) => (
            <div key={index} className="flex items-baseline gap-2 text-sm">
              <span className="text-slate-500 flex-shrink-0">{takeaway.label}:</span>
              <span className="font-medium text-slate-900">
                {takeaway.value}
                {takeaway.when && (
                  <span className="text-slate-500 font-normal ml-1">({takeaway.when})</span>
                )}
              </span>
              {takeaway.confidence === 'low' && (
                <span className="text-orange-500 text-xs">?</span>
              )}
            </div>
          ))}
          {hiddenCount > 0 && (
            <button
              onClick={onExpand}
              className="text-sm text-teal-600 hover:text-teal-700"
            >
              +{hiddenCount} more
            </button>
          )}
        </div>
      )}

      {/* Warnings */}
      {data.outcome?.warnings && data.outcome.warnings.length > 0 && (
        <div className="px-4 py-3 bg-white border-b border-slate-200">
          <div className="text-xs text-orange-600 bg-orange-50 rounded-lg px-3 py-2">
            {data.outcome.warnings[0]}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="px-4 py-3 bg-slate-50 flex items-center justify-end gap-2">
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

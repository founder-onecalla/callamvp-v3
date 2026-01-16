import type { CallCardData } from '../../lib/types'
import { STATUS_LABELS, STATUS_COLORS } from '../../lib/types'

interface CallCardCollapsedProps {
  data: CallCardData
  onExpand: () => void
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
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          {/* Status pill */}
          <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusColors.bg} ${statusColors.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusColors.dot}`} />
            {statusLabel}
          </span>

          {/* Contact */}
          <span className="text-sm font-medium text-gray-900 truncate">
            {displayName}
          </span>
        </div>

        <div className="flex items-center gap-3 text-sm text-gray-500 flex-shrink-0">
          {/* Timestamp */}
          <span>{formatTimestamp(data.createdAt)}</span>

          {/* Duration */}
          {data.durationSec !== null && data.durationSec > 0 && (
            <span className="font-mono">{formatDuration(data.durationSec)}</span>
          )}
        </div>
      </div>

      {/* Outcome sentence */}
      {data.outcome?.sentence && (
        <div className="px-4 pb-3">
          <p className="text-sm text-gray-700 leading-relaxed">
            {data.outcome.sentence}
          </p>
        </div>
      )}

      {/* Takeaways */}
      {visibleTakeaways.length > 0 && (
        <div className="px-4 pb-3 space-y-1.5">
          {visibleTakeaways.map((takeaway, index) => (
            <div key={index} className="flex items-baseline gap-2 text-sm">
              <span className="text-gray-500 flex-shrink-0">{takeaway.label}:</span>
              <span className="font-medium text-gray-900">
                {takeaway.value}
                {takeaway.when && (
                  <span className="text-gray-500 font-normal ml-1">({takeaway.when})</span>
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
              className="text-sm text-blue-500 hover:text-blue-600"
            >
              +{hiddenCount} more
            </button>
          )}
        </div>
      )}

      {/* Warnings */}
      {data.outcome?.warnings && data.outcome.warnings.length > 0 && (
        <div className="px-4 pb-3">
          <div className="text-xs text-orange-600 bg-orange-50 rounded-lg px-3 py-2">
            {data.outcome.warnings[0]}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
        <button
          onClick={onExpand}
          className="min-h-[36px] px-4 text-sm font-medium text-blue-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
        >
          View details
        </button>
      </div>
    </div>
  )
}

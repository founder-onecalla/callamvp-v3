import { useState } from 'react'
import type { CallWithTranscripts } from '../../hooks/useCallHistory'

interface CallHistoryCardProps {
  call: CallWithTranscripts
}

const outcomeConfig: Record<string, { label: string; color: string; icon: string }> = {
  completed: { label: 'Completed', color: 'text-green-600', icon: '✓' },
  voicemail: { label: 'Voicemail', color: 'text-orange-500', icon: '📫' },
  busy: { label: 'Busy', color: 'text-yellow-600', icon: '🔄' },
  no_answer: { label: 'No Answer', color: 'text-gray-500', icon: '📵' },
  declined: { label: 'Declined', color: 'text-red-500', icon: '✕' },
  cancelled: { label: 'Cancelled', color: 'text-gray-400', icon: '⊘' },
  default: { label: 'Ended', color: 'text-gray-500', icon: '📞' },
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function CallHistoryCard({ call }: CallHistoryCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const outcome = outcomeConfig[call.outcome || ''] || outcomeConfig.default
  const hasTranscripts = call.transcriptions && call.transcriptions.length > 0

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header - Clickable to expand */}
      <div
        className={`px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${
          hasTranscripts ? '' : 'opacity-75'
        }`}
        onClick={() => hasTranscripts && setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg">{outcome.icon}</span>
            <div>
              <p className="font-medium text-gray-900 text-sm">{call.phone_number}</p>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className={outcome.color}>{outcome.label}</span>
                <span>•</span>
                <span>{formatDuration(call.duration_seconds)}</span>
                <span>•</span>
                <span>{formatTime(call.created_at)}</span>
              </div>
            </div>
          </div>
          {hasTranscripts && (
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </div>

        {/* Summary if available */}
        {call.summary && !isExpanded && (
          <p className="text-xs text-gray-500 mt-2 line-clamp-2">{call.summary}</p>
        )}
      </div>

      {/* Expanded transcript view */}
      {isExpanded && hasTranscripts && (
        <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 max-h-64 overflow-y-auto">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">Transcript</p>
          <div className="space-y-2">
            {call.transcriptions.map((t) => (
              <div key={t.id} className="text-sm">
                <span
                  className={`font-medium ${
                    t.speaker === 'agent' ? 'text-blue-500' : 'text-gray-600'
                  }`}
                >
                  {t.speaker === 'agent' ? 'AI' : 'Them'}:
                </span>{' '}
                <span className="text-gray-700">{t.content}</span>
              </div>
            ))}
          </div>

          {/* Full summary if available */}
          {call.summary && (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-1">Summary</p>
              <p className="text-sm text-gray-600">{call.summary}</p>
            </div>
          )}
        </div>
      )}

      {/* No transcript message */}
      {!hasTranscripts && (
        <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
          <p className="text-xs text-gray-400 italic">
            {call.outcome === 'voicemail' ? 'Reached voicemail' : 'No transcript available'}
          </p>
        </div>
      )}
    </div>
  )
}

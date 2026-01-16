import { useState } from 'react'
import type { TimelineEvent } from '../../lib/types'

interface TroubleshootingPanelProps {
  timeline: TimelineEvent[]
  endReason: { label: string; code: string } | null
  provider: { name: string; callControlId: string | null }
}

// Icon mapping for timeline event types
const EVENT_ICONS: Record<string, string> = {
  'status_change': '📞',
  'ringing': '🔔',
  'connected': '✅',
  'ended': '📴',
  'hangup': '📴',
  'dtmf_sent': '🔢',
  'dtmf_received': '🔢',
  'ivr_navigation': '🤖',
  'transcription_started': '🎤',
  'agent_speech': '💬',
  'mutual_goodbye': '👋',
  'closing_aborted': '🔄',
  'error': '⚠️',
  'streaming': '📡',
  'realtime_api': '🤖',
}

function getEventIcon(type: string): string {
  return EVENT_ICONS[type] || '•'
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  })
}

export default function TroubleshootingPanel({ timeline, endReason, provider }: TroubleshootingPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [copiedId, setCopiedId] = useState(false)

  const handleCopyId = async () => {
    if (provider.callControlId) {
      await navigator.clipboard.writeText(provider.callControlId)
      setCopiedId(true)
      setTimeout(() => setCopiedId(false), 2000)
    }
  }

  return (
    <div className="border-t border-gray-100 pt-3 mt-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <svg
          className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        Troubleshooting
      </button>

      {isExpanded && (
        <div className="mt-3 space-y-4">
          {/* Timeline */}
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Call Timeline
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {timeline.length === 0 ? (
                <div className="text-sm text-gray-400">No events recorded</div>
              ) : (
                timeline.map((event, index) => (
                  <div key={index} className="flex items-start gap-2 text-sm">
                    <span className="flex-shrink-0 w-5 text-center">
                      {getEventIcon(event.type)}
                    </span>
                    <span className="text-gray-400 flex-shrink-0 w-20">
                      {formatTime(event.t)}
                    </span>
                    <span className="text-gray-700 flex-1 truncate">
                      {event.description || event.type.replace(/_/g, ' ')}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* End Reason */}
          {endReason && (
            <div>
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                End Reason
              </div>
              <div className="text-sm text-gray-700">
                {endReason.label}
                <span className="text-gray-400 ml-2">({endReason.code})</span>
              </div>
            </div>
          )}

          {/* Provider Info */}
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
              Technical Details
            </div>
            <div className="text-sm space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-gray-500">Provider:</span>
                <span className="text-gray-700">{provider.name}</span>
              </div>
              {provider.callControlId && (
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">Call ID:</span>
                  <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 truncate max-w-[180px]">
                    {provider.callControlId}
                  </code>
                  <button
                    onClick={handleCopyId}
                    className="text-gray-400 hover:text-gray-600 p-1"
                    title="Copy ID"
                  >
                    {copiedId ? (
                      <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

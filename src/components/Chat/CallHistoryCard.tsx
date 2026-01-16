import { useState } from 'react'
import type { CallWithTranscripts } from '../../hooks/useCallHistory'
import { STATUS_COLORS } from '../../lib/types'
import TranscriptView from './TranscriptView'

interface CallHistoryCardProps {
  call: CallWithTranscripts
}

// Map DB outcome to our status type
function getStatus(outcome: string | null | undefined): 'completed' | 'voicemail' | 'busy' | 'no_answer' | 'failed' | 'canceled' {
  switch (outcome) {
    case 'completed': return 'completed'
    case 'voicemail': return 'voicemail'
    case 'busy': return 'busy'
    case 'no_answer': return 'no_answer'
    case 'declined':
    case 'failed': return 'failed'
    case 'cancelled': return 'canceled'
    default: return 'completed'
  }
}

const STATUS_LABELS: Record<string, string> = {
  completed: 'Completed',
  voicemail: 'Voicemail',
  busy: 'Busy',
  no_answer: 'No answer',
  failed: 'Failed',
  canceled: 'Canceled',
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '--:--'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
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

  const status = getStatus(call.outcome)
  const statusColors = STATUS_COLORS[status]
  const statusLabel = STATUS_LABELS[status]

  // Build transcript turns from ASR (them) and agent_speech events (agent)
  // 1. ASR transcriptions - what "them" said
  const asrTurns = (call.transcriptions || []).map(t => ({
    speaker: 'them' as const,
    text: t.content,
    timestamp: t.created_at,
    confidence: t.confidence
  }))

  // 2. Agent speech events - what our agent said (TTS text)
  const agentSpeechEvents = (call.call_events || []).filter(e => e.event_type === 'agent_speech')
  const agentTurns = agentSpeechEvents.map(e => ({
    speaker: 'agent' as const,
    text: e.description || '',
    timestamp: e.created_at,
    confidence: null as number | null
  }))

  // 3. Merge and sort chronologically
  const transcriptTurns = [...asrTurns, ...agentTurns]
    .filter(t => t.text && t.text.trim().length > 0)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

  const hasTranscripts = transcriptTurns.length > 0

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div
        className={`px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${
          hasTranscripts ? '' : 'opacity-75'
        }`}
        onClick={() => hasTranscripts && setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {/* Status pill */}
            <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${statusColors.bg} ${statusColors.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${statusColors.dot}`} />
              {statusLabel}
            </span>

            {/* Phone number */}
            <span className="text-sm font-medium text-gray-900 truncate">
              {call.phone_number}
            </span>
          </div>

          <div className="flex items-center gap-3 text-sm text-gray-500 flex-shrink-0">
            {call.duration_seconds && call.duration_seconds > 0 && (
              <span className="font-mono">{formatDuration(call.duration_seconds)}</span>
            )}
            <span>{formatTime(call.created_at)}</span>
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
        </div>

        {/* Summary preview if available */}
        {call.summary && !isExpanded && (
          <p className="text-sm text-gray-600 mt-2 line-clamp-2 leading-relaxed">{call.summary}</p>
        )}
      </div>

      {/* Expanded view */}
      {isExpanded && hasTranscripts && (
        <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
          {/* Summary */}
          {call.summary && (
            <div className="mb-3 pb-3 border-b border-gray-200">
              <p className="text-sm text-gray-700 leading-relaxed">{call.summary}</p>
            </div>
          )}

          {/* Transcript */}
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Conversation
          </div>
          <div className="bg-white rounded-lg p-3 border border-gray-100">
            <TranscriptView turns={transcriptTurns} maxHeight="200px" />
          </div>
        </div>
      )}

      {/* No transcript message */}
      {!hasTranscripts && (
        <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
          <p className="text-xs text-gray-400">
            {call.outcome === 'voicemail' ? 'Reached voicemail' : 'No transcript available'}
          </p>
        </div>
      )}
    </div>
  )
}

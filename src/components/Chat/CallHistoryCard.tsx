import { useState } from 'react'
import type { CallWithTranscripts } from '../../hooks/useCallHistory'
import { STATUS_COLORS } from '../../lib/types'
import CallTranscriptView from './CallTranscriptView'

interface CallHistoryCardProps {
  call: CallWithTranscripts
}

// Call icon for artifact header
function CallIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
    </svg>
  )
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
  const asrTurns = (call.transcriptions || []).map(t => ({
    speaker: 'them' as const,
    text: t.content,
    timestamp: t.created_at,
    confidence: t.confidence
  }))

  const agentSpeechEvents = (call.call_events || []).filter(e => e.event_type === 'agent_speech')
  const agentTurns = agentSpeechEvents.map(e => ({
    speaker: 'agent' as const,
    text: e.description || '',
    timestamp: e.created_at,
    confidence: null as number | null
  }))

  const transcriptTurns = [...asrTurns, ...agentTurns]
    .filter(t => t.text && t.text.trim().length > 0)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

  const hasTranscripts = transcriptTurns.length > 0

  return (
    // Call artifact container - consistent with other call cards
    <div className="bg-slate-50 rounded-xl border-2 border-slate-200 overflow-hidden shadow-sm">
      {/* Header - clickable to expand */}
      <div
        className={`cursor-pointer hover:bg-slate-100 transition-colors ${
          hasTranscripts ? '' : 'opacity-75'
        }`}
        onClick={() => hasTranscripts && setIsExpanded(!isExpanded)}
      >
        {/* Mode Header */}
        <div className="bg-slate-100 px-3 py-2 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-teal-500 flex items-center justify-center flex-shrink-0">
              <CallIcon className="w-3 h-3 text-white" />
            </div>
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <span className="text-sm font-medium text-slate-700 truncate">
                {call.phone_number}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500 flex-shrink-0">
              {call.duration_seconds && call.duration_seconds > 0 && (
                <span className="font-mono">{formatDuration(call.duration_seconds)}</span>
              )}
              <span>{formatTime(call.created_at)}</span>
              {hasTranscripts && (
                <svg
                  className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              )}
            </div>
          </div>
        </div>

        {/* Status and summary */}
        <div className="px-3 py-2 bg-white">
          <div className="flex items-center gap-2 mb-1">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusColors.bg} ${statusColors.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${statusColors.dot}`} />
              {statusLabel}
            </span>
          </div>
          {/* Summary preview if available */}
          {call.summary && !isExpanded && (
            <p className="text-sm text-slate-600 line-clamp-2 leading-relaxed">{call.summary}</p>
          )}
        </div>
      </div>

      {/* Expanded view */}
      {isExpanded && hasTranscripts && (
        <div className="px-3 py-3 border-t border-slate-200 bg-white">
          {/* Summary */}
          {call.summary && (
            <div className="mb-3 pb-3 border-b border-slate-200">
              <p className="text-sm text-slate-700 leading-relaxed">{call.summary}</p>
            </div>
          )}

          {/* Transcript - using call mode view */}
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
            Conversation
          </div>
          <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
            <CallTranscriptView
              turns={transcriptTurns}
              otherPartyName={call.phone_number}
              maxHeight="200px"
              isLive={false}
            />
          </div>
        </div>
      )}

      {/* No transcript message */}
      {!hasTranscripts && (
        <div className="px-3 py-2 border-t border-slate-200 bg-slate-50">
          <p className="text-xs text-slate-400">
            {call.outcome === 'voicemail' ? 'Reached voicemail' : 'No transcript available'}
          </p>
        </div>
      )}
    </div>
  )
}

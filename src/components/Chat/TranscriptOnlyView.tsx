import type { TranscriptTurn } from '../../lib/types'
import CallTranscriptView from './CallTranscriptView'

interface TranscriptOnlyViewProps {
  phoneNumber: string
  endedAt: string | null
  turns: TranscriptTurn[]
  onClose: () => void
}

function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

export default function TranscriptOnlyView({
  phoneNumber,
  endedAt,
  turns,
  onClose,
}: TranscriptOnlyViewProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm max-w-md">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Transcript</h3>
          <p className="text-xs text-slate-500">
            {phoneNumber}{endedAt && ` · ${formatTimestamp(endedAt)}`}
          </p>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          title="Close"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Transcript content */}
      <div className="px-4 py-3">
        {turns.length > 0 ? (
          <CallTranscriptView
            turns={turns}
            otherPartyName={phoneNumber}
            maxHeight="400px"
            isLive={false}
          />
        ) : (
          <div className="text-sm text-slate-500 text-center py-8">
            No transcript available for this call.
          </div>
        )}
      </div>

      {/* Footer action */}
      <div className="px-4 py-3 border-t border-slate-100 bg-slate-50">
        <button
          onClick={onClose}
          className="w-full py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
        >
          Back to recap
        </button>
      </div>
    </div>
  )
}

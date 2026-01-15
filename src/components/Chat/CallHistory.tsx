import { useState } from 'react'
import { useCallHistory } from '../../hooks/useCallHistory'
import CallHistoryCard from './CallHistoryCard'

export default function CallHistory() {
  const { calls, isLoading, error } = useCallHistory(20)
  const [isExpanded, setIsExpanded] = useState(false)

  // Only show ended calls
  const endedCalls = calls.filter(c => c.status === 'ended')

  if (endedCalls.length === 0 && !isLoading) {
    return null
  }

  return (
    <div className="border-t border-gray-200 bg-gray-50">
      {/* Toggle header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-gray-400">📋</span>
          <span className="text-sm font-medium text-gray-600">
            Call History ({endedCalls.length})
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded history list */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-2 max-h-96 overflow-y-auto">
          {isLoading && (
            <div className="text-center py-4">
              <div className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin mx-auto" />
            </div>
          )}

          {error && (
            <div className="text-center py-4 text-sm text-red-500">{error}</div>
          )}

          {!isLoading && endedCalls.map((call) => (
            <CallHistoryCard key={call.id} call={call} />
          ))}

          {!isLoading && endedCalls.length === 0 && (
            <p className="text-center py-4 text-sm text-gray-400">No call history yet</p>
          )}
        </div>
      )}
    </div>
  )
}

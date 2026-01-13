import { useEffect, useRef } from 'react'
import { useCall } from '../../hooks/useCall'

const statusColors = {
  pending: 'text-yellow-500',
  ringing: 'text-yellow-500',
  answered: 'text-green-500',
  ended: 'text-gray-500',
}

const statusLabels = {
  pending: 'Connecting...',
  ringing: 'Ringing...',
  answered: 'Connected',
  ended: 'Call Ended',
}

export default function CallArea() {
  const { currentCall, transcriptions } = useCall()
  const transcriptEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcriptions])

  if (!currentCall) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <div className="text-center">
          <div className="text-6xl mb-4">📞</div>
          <p>No active call</p>
          <p className="text-sm mt-2">Ask the AI to place a call to get started</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Call Status Header */}
      <div className="px-6 py-4 border-b border-gray-800 bg-gray-900/50">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-400">Calling</p>
            <p className="text-lg font-mono">{currentCall.phone_number}</p>
          </div>
          <div className="text-right">
            <div className={`flex items-center gap-2 ${statusColors[currentCall.status]}`}>
              {currentCall.status === 'answered' && (
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              )}
              {(currentCall.status === 'pending' || currentCall.status === 'ringing') && (
                <span className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
              )}
              <span className="font-medium">{statusLabels[currentCall.status]}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Transcription Area */}
      <div className="flex-1 overflow-y-auto p-6">
        <h3 className="text-sm font-medium text-gray-400 mb-4">Live Transcription</h3>

        {transcriptions.length === 0 ? (
          <p className="text-gray-600 text-center mt-8">
            {currentCall.status === 'answered'
              ? 'Waiting for speech...'
              : 'Transcription will appear when the call connects'}
          </p>
        ) : (
          <div className="space-y-3">
            {transcriptions.map((t) => (
              <div
                key={t.id}
                className={`flex ${t.speaker === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2 ${
                    t.speaker === 'user'
                      ? 'bg-blue-600/20 border border-blue-600/30'
                      : 'bg-gray-800 border border-gray-700'
                  }`}
                >
                  <p className="text-xs text-gray-500 mb-1">
                    {t.speaker === 'user' ? 'You' : 'Remote'}
                  </p>
                  <p>{t.content}</p>
                </div>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>
        )}
      </div>
    </div>
  )
}

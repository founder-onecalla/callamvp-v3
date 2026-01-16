import { useState, useEffect, useRef } from 'react'
import { useCall } from '../../hooks/useCall'
import { useAudioStream } from '../../hooks/useAudioStream'
import CallCardCollapsed from './CallCardCollapsed'
import CallCardExpanded from './CallCardExpanded'
import TranscriptView from './TranscriptView'

const dtmfButtons = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']
const AUDIO_RELAY_URL = import.meta.env.VITE_AUDIO_RELAY_URL || ''

const statusConfig = {
  pending: { label: 'Connecting', color: 'text-orange-500', dot: 'bg-orange-500' },
  ringing: { label: 'Ringing', color: 'text-orange-500', dot: 'bg-orange-500' },
  answered: { label: 'In progress', color: 'text-blue-500', dot: 'bg-blue-500' },
  ended: { label: 'Ended', color: 'text-gray-400', dot: 'bg-gray-400' },
}

export default function CallCard() {
  const { currentCall, transcriptions, hangUp, sendDtmf, callCardData } = useCall()
  const [isExpanded, setIsExpanded] = useState(false)
  const [showKeypad, setShowKeypad] = useState(false)
  const [duration, setDuration] = useState(0)
  const transcriptEndRef = useRef<HTMLDivElement>(null)

  const {
    isConnected: isListening,
    connect: startListening,
    disconnect: stopListening,
  } = useAudioStream({
    relayUrl: AUDIO_RELAY_URL,
    callId: currentCall?.id ?? null,
  })

  // Duration timer
  useEffect(() => {
    if (currentCall?.status !== 'answered') {
      setDuration(0)
      return
    }

    const interval = setInterval(() => {
      setDuration((d) => d + 1)
    }, 1000)

    return () => clearInterval(interval)
  }, [currentCall?.status])

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [transcriptions])

  if (!currentCall) return null

  const minutes = Math.floor(duration / 60)
  const seconds = duration % 60
  const timeDisplay = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`

  // If call ended and we have structured data, show the new card design
  if (currentCall.status === 'ended' && callCardData) {
    return isExpanded ? (
      <CallCardExpanded data={callCardData} onCollapse={() => setIsExpanded(false)} />
    ) : (
      <CallCardCollapsed data={callCardData} onExpand={() => setIsExpanded(true)} />
    )
  }

  // Active call view (pending, ringing, answered)
  const status = statusConfig[currentCall.status]

  // Convert transcriptions to TranscriptTurn format for display
  const transcriptTurns = transcriptions.map(t => ({
    speaker: (t.speaker === 'user' || t.speaker === 'agent') ? 'agent' as const : 'them' as const,
    text: t.content,
    timestamp: t.created_at,
    confidence: t.confidence
  }))

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden w-full max-w-sm">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="relative">
              <span className={`w-2.5 h-2.5 rounded-full ${status.dot} block`} />
              {(currentCall.status === 'answered' || currentCall.status === 'ringing' || currentCall.status === 'pending') && (
                <span className={`absolute inset-0 w-2.5 h-2.5 rounded-full ${status.dot} pulse-ring`} />
              )}
            </div>
            <span className={`font-medium text-sm ${status.color}`}>{status.label}</span>
          </div>
          {currentCall.status === 'answered' && (
            <span className="text-gray-500 font-mono text-sm">{timeDisplay}</span>
          )}
        </div>
        <p className="text-sm text-gray-900 mt-1 font-medium">{currentCall.phone_number}</p>
      </div>

      {/* Live Transcript for active calls */}
      {currentCall.status === 'answered' && transcriptTurns.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Live Conversation
          </div>
          <div className="max-h-32 overflow-y-auto">
            <TranscriptView turns={transcriptTurns} maxHeight="120px" />
            <div ref={transcriptEndRef} />
          </div>
        </div>
      )}

      {/* Status messages for non-connected states */}
      {currentCall.status === 'pending' && (
        <div className="px-4 py-4 text-center">
          <div className="text-sm text-gray-500">Initiating call...</div>
        </div>
      )}

      {currentCall.status === 'ringing' && (
        <div className="px-4 py-4 text-center">
          <div className="text-sm text-gray-500">Waiting for answer...</div>
        </div>
      )}

      {/* Controls */}
      {currentCall.status !== 'ended' && (
        <div className="px-4 py-3 bg-gray-50 space-y-2">
          <div className="flex gap-2">
            <button
              onClick={hangUp}
              className="flex-1 min-h-[44px] bg-red-500 hover:bg-red-600 text-white rounded-full text-sm font-medium transition-all duration-200"
            >
              End Call
            </button>
            {currentCall.status === 'answered' && (
              <button
                onClick={() => setShowKeypad(!showKeypad)}
                className={`px-4 min-h-[44px] rounded-full text-sm font-medium transition-all duration-200 ${
                  showKeypad
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Keypad
              </button>
            )}
            {AUDIO_RELAY_URL && currentCall.status === 'answered' && (
              <button
                onClick={isListening ? stopListening : startListening}
                className={`w-11 h-11 rounded-full text-sm font-medium transition-all duration-200 flex items-center justify-center ${
                  isListening
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
                title={isListening ? 'Stop listening' : 'Listen in'}
              >
                {isListening ? '🔊' : '🎧'}
              </button>
            )}
          </div>

          {/* Keypad */}
          {showKeypad && currentCall.status === 'answered' && (
            <div className="grid grid-cols-3 gap-2 pt-2">
              {dtmfButtons.map((digit) => (
                <button
                  key={digit}
                  onClick={() => sendDtmf(digit)}
                  className="min-h-[44px] bg-white hover:bg-gray-100 border border-gray-200 rounded-xl text-lg font-medium transition-all duration-150"
                >
                  {digit}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Ended state fallback (when callCardData not yet loaded) */}
      {currentCall.status === 'ended' && !callCardData && (
        <div className="px-4 py-4 bg-gray-50 border-t border-gray-100">
          <div className="flex items-center justify-center gap-2 text-gray-500">
            <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
            <span className="text-sm">Loading summary...</span>
          </div>
        </div>
      )}
    </div>
  )
}

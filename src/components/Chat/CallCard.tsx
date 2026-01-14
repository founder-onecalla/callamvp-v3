import { useState, useEffect, useRef } from 'react'
import { useCall } from '../../hooks/useCall'
import { useAudioStream } from '../../hooks/useAudioStream'

const dtmfButtons = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']
const AUDIO_RELAY_URL = import.meta.env.VITE_AUDIO_RELAY_URL || ''

const statusConfig = {
  pending: { label: 'Connecting', color: 'text-orange-500', dot: 'bg-orange-500' },
  ringing: { label: 'Ringing', color: 'text-orange-500', dot: 'bg-orange-500' },
  answered: { label: 'Connected', color: 'text-green-500', dot: 'bg-green-500' },
  ended: { label: 'Ended', color: 'text-gray-400', dot: 'bg-gray-400' },
}

const eventTypeIcons: Record<string, string> = {
  status_change: '📞',
  dtmf_sent: '🔢',
  dtmf_received: '🔢',
  ivr_navigation: '🤖',
  transcription: '💬',
  error: '⚠️',
}

export default function CallCard() {
  const { currentCall, transcriptions, callEvents, hangUp, sendDtmf } = useCall()
  const [isExpanded, setIsExpanded] = useState(false)
  const [showKeypad, setShowKeypad] = useState(false)
  const [duration, setDuration] = useState(0)
  const eventsEndRef = useRef<HTMLDivElement>(null)

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

  // Auto-scroll events
  useEffect(() => {
    if (isExpanded && eventsEndRef.current) {
      eventsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [callEvents, isExpanded])

  // Auto-expand on first event
  useEffect(() => {
    if (callEvents.length === 1) {
      setIsExpanded(true)
    }
  }, [callEvents.length])

  if (!currentCall) return null

  const status = statusConfig[currentCall.status]
  const minutes = Math.floor(duration / 60)
  const seconds = duration % 60
  const timeDisplay = `${minutes}:${seconds.toString().padStart(2, '0')}`

  // Filter events for display (exclude transcription events since we show those separately)
  const displayEvents = callEvents.filter(e => e.event_type !== 'transcription')

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden max-w-sm">
      {/* Header - Clickable to expand */}
      <div
        className="px-4 py-3 bg-gray-50 border-b border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="relative">
              <span className={`w-2.5 h-2.5 rounded-full ${status.dot} block`} />
              {(currentCall.status === 'answered' || currentCall.status === 'ringing') && (
                <span className={`absolute inset-0 w-2.5 h-2.5 rounded-full ${status.dot} pulse-ring`} />
              )}
            </div>
            <span className={`font-medium text-sm ${status.color}`}>{status.label}</span>
          </div>
          <div className="flex items-center gap-2">
            {currentCall.status === 'answered' && (
              <span className="text-gray-400 font-mono text-sm">{timeDisplay}</span>
            )}
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
        <p className="text-sm text-gray-600 mt-1 font-medium">{currentCall.phone_number}</p>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <>
          {/* Live Events Feed */}
          {displayEvents.length > 0 && (
            <div className="px-4 py-3 max-h-32 overflow-y-auto bg-gray-50 border-b border-gray-100">
              <div className="space-y-1.5">
                {displayEvents.map((event) => (
                  <div key={event.id} className="flex items-start gap-2 text-xs">
                    <span className="flex-shrink-0">{eventTypeIcons[event.event_type] || '•'}</span>
                    <span className="text-gray-600">{event.description}</span>
                  </div>
                ))}
                <div ref={eventsEndRef} />
              </div>
            </div>
          )}

          {/* Transcription */}
          {transcriptions.length > 0 && (
            <div className="px-4 py-3 max-h-40 overflow-y-auto space-y-2 bg-white border-b border-gray-100">
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Live Transcript</p>
              {transcriptions.map((t) => (
                <div key={t.id} className="text-sm">
                  <span className={`font-medium ${t.speaker === 'user' ? 'text-blue-500' : 'text-gray-500'}`}>
                    {t.speaker === 'user' ? 'You' : 'Them'}:
                  </span>{' '}
                  <span className="text-gray-700">{t.content}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Controls */}
      {currentCall.status !== 'ended' && (
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 space-y-2">
          <div className="flex gap-2">
            <button
              onClick={hangUp}
              className="flex-1 py-2 bg-red-500 hover:bg-red-600 text-white rounded-full text-sm font-medium transition-all duration-200"
            >
              End Call
            </button>
            <button
              onClick={() => setShowKeypad(!showKeypad)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                showKeypad
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Keypad
            </button>
            {AUDIO_RELAY_URL && currentCall.status === 'answered' && (
              <button
                onClick={isListening ? stopListening : startListening}
                className={`w-10 h-10 rounded-full text-sm font-medium transition-all duration-200 flex items-center justify-center ${
                  isListening
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {isListening ? '🔊' : '🎧'}
              </button>
            )}
          </div>

          {/* Keypad */}
          {showKeypad && (
            <div className="grid grid-cols-3 gap-1.5 pt-2">
              {dtmfButtons.map((digit) => (
                <button
                  key={digit}
                  onClick={() => sendDtmf(digit)}
                  disabled={currentCall.status !== 'answered'}
                  className="py-2.5 bg-white hover:bg-gray-100 disabled:bg-gray-50 disabled:text-gray-300 border border-gray-200 rounded-xl text-lg font-medium transition-all duration-150"
                >
                  {digit}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Ended state */}
      {currentCall.status === 'ended' && (
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 text-center">
          <p className="text-sm text-gray-400">Call ended</p>
        </div>
      )}
    </div>
  )
}

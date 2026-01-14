import { useState, useEffect } from 'react'
import { useCall } from '../../hooks/useCall'
import { useAudioStream } from '../../hooks/useAudioStream'

const dtmfButtons = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']
const AUDIO_RELAY_URL = import.meta.env.VITE_AUDIO_RELAY_URL || ''

const statusConfig = {
  pending: { label: 'Connecting...', color: 'text-yellow-500', bg: 'bg-yellow-500' },
  ringing: { label: 'Ringing...', color: 'text-yellow-500', bg: 'bg-yellow-500' },
  answered: { label: 'Connected', color: 'text-green-500', bg: 'bg-green-500' },
  ended: { label: 'Call Ended', color: 'text-gray-500', bg: 'bg-gray-500' },
}

export default function CallCard() {
  const { currentCall, transcriptions, hangUp, sendDtmf } = useCall()
  const [showKeypad, setShowKeypad] = useState(false)
  const [duration, setDuration] = useState(0)

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

  if (!currentCall) return null

  const status = statusConfig[currentCall.status]
  const minutes = Math.floor(duration / 60)
  const seconds = duration % 60
  const timeDisplay = `${minutes}:${seconds.toString().padStart(2, '0')}`

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden max-w-md">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-900/50 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${status.bg} ${currentCall.status === 'answered' || currentCall.status === 'ringing' ? 'animate-pulse' : ''}`} />
            <span className={`font-medium ${status.color}`}>{status.label}</span>
          </div>
          {currentCall.status === 'answered' && (
            <span className="text-gray-400 font-mono text-sm">{timeDisplay}</span>
          )}
        </div>
        <p className="text-sm text-gray-400 mt-1 font-mono">{currentCall.phone_number}</p>
      </div>

      {/* Transcription */}
      {transcriptions.length > 0 && (
        <div className="px-4 py-3 max-h-48 overflow-y-auto space-y-2">
          {transcriptions.map((t) => (
            <div key={t.id} className={`text-sm ${t.speaker === 'user' ? 'text-blue-400' : 'text-gray-300'}`}>
              <span className="text-gray-500 text-xs">{t.speaker === 'user' ? 'You' : 'Them'}:</span>{' '}
              {t.content}
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      {currentCall.status !== 'ended' && (
        <div className="px-4 py-3 border-t border-gray-700 space-y-3">
          <div className="flex gap-2">
            <button
              onClick={hangUp}
              className="flex-1 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium transition"
            >
              Hang Up
            </button>
            <button
              onClick={() => setShowKeypad(!showKeypad)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                showKeypad ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              Keypad
            </button>
            {AUDIO_RELAY_URL && currentCall.status === 'answered' && (
              <button
                onClick={isListening ? stopListening : startListening}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  isListening ? 'bg-green-600' : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                {isListening ? '🔊' : '🎧'}
              </button>
            )}
          </div>

          {/* Keypad */}
          {showKeypad && (
            <div className="grid grid-cols-3 gap-1">
              {dtmfButtons.map((digit) => (
                <button
                  key={digit}
                  onClick={() => sendDtmf(digit)}
                  disabled={currentCall.status !== 'answered'}
                  className="py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 rounded text-lg font-mono transition"
                >
                  {digit}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

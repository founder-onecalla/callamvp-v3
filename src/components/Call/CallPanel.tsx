import { useState } from 'react'
import { useCall } from '../../hooks/useCall'
import { useAudioStream } from '../../hooks/useAudioStream'

const dtmfButtons = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']

// Audio relay URL - set this after deploying to Deno Deploy
const AUDIO_RELAY_URL = import.meta.env.VITE_AUDIO_RELAY_URL || ''

export default function CallPanel() {
  const { currentCall, isLoading, error, startCall, hangUp, sendDtmf } = useCall()
  const [phoneNumber, setPhoneNumber] = useState('')
  const [showDtmf, setShowDtmf] = useState(false)

  const {
    isConnected: isListening,
    isPlaying,
    error: audioError,
    connect: startListening,
    disconnect: stopListening,
  } = useAudioStream({
    relayUrl: AUDIO_RELAY_URL,
    callId: currentCall?.id ?? null,
  })

  const handleStartCall = async () => {
    if (!phoneNumber.trim()) return
    await startCall(phoneNumber.trim())
    setPhoneNumber('')
  }

  const handleDtmf = async (digit: string) => {
    await sendDtmf(digit)
  }

  const handleListenToggle = () => {
    if (isListening) {
      stopListening()
    } else {
      startListening()
    }
  }

  return (
    <div className="p-6">
      {(error || audioError) && (
        <div className="mb-4 bg-red-500/10 border border-red-500 text-red-500 px-4 py-3 rounded text-sm">
          {error || audioError}
        </div>
      )}

      {!currentCall ? (
        // No active call - show dial interface
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Phone Number
            </label>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+1 555-123-4567"
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition font-mono"
            />
          </div>
          <button
            onClick={handleStartCall}
            disabled={isLoading || !phoneNumber.trim()}
            className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 rounded-lg font-medium transition flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <span className="animate-spin">⏳</span>
                Connecting...
              </>
            ) : (
              <>
                📞 Start Call
              </>
            )}
          </button>
        </div>
      ) : (
        // Active call - show call controls
        <div className="space-y-4">
          {/* Main controls */}
          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() => setShowDtmf(!showDtmf)}
              className={`py-3 rounded-lg font-medium transition ${
                showDtmf
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
              }`}
            >
              ⌨️ Keypad
            </button>

            <button
              onClick={hangUp}
              disabled={isLoading || currentCall.status === 'ended'}
              className="py-3 bg-red-600 hover:bg-red-700 disabled:bg-red-600/50 rounded-lg font-medium transition"
            >
              📵 Hang Up
            </button>

            <button
              onClick={handleListenToggle}
              disabled={currentCall.status !== 'answered' || !AUDIO_RELAY_URL}
              className={`py-3 rounded-lg font-medium transition ${
                isListening
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
              } disabled:bg-gray-800/50 disabled:text-gray-600`}
              title={
                !AUDIO_RELAY_URL
                  ? 'Audio relay not configured'
                  : isListening
                  ? 'Click to stop listening'
                  : 'Click to listen to call audio'
              }
            >
              {isListening ? (
                <>
                  {isPlaying ? '🔊' : '🎧'} Listening
                </>
              ) : (
                <>🎧 Listen</>
              )}
            </button>
          </div>

          {/* Listening indicator */}
          {isListening && (
            <div className="flex items-center justify-center gap-2 py-2 bg-green-600/10 border border-green-600/30 rounded-lg">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-green-500 text-sm">
                {isPlaying ? 'Receiving audio...' : 'Connected, waiting for audio...'}
              </span>
            </div>
          )}

          {/* DTMF Keypad */}
          {showDtmf && (
            <div className="grid grid-cols-3 gap-2 pt-4 border-t border-gray-800">
              {dtmfButtons.map((digit) => (
                <button
                  key={digit}
                  onClick={() => handleDtmf(digit)}
                  disabled={currentCall.status !== 'answered'}
                  className="py-4 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-800/50 disabled:text-gray-600 rounded-lg text-xl font-mono transition"
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

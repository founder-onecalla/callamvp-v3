import { useState, useEffect } from 'react'
import { useCall } from '../../hooks/useCall'
import { useAudioStream } from '../../hooks/useAudioStream'
import CallCardCollapsed from './CallCardCollapsed'
import CallCardExpanded from './CallCardExpanded'
import CallTranscriptView from './CallTranscriptView'

const dtmfButtons = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']
const AUDIO_RELAY_URL = import.meta.env.VITE_AUDIO_RELAY_URL || ''

// Call icon for artifact header
function CallIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
    </svg>
  )
}

// Status configurations for active call states
const statusConfig: Record<string, { label: string; speaking: string }> = {
  pending: { label: 'Connecting', speaking: 'connecting to' },
  ringing: { label: 'Ringing', speaking: 'calling' },
  answered: { label: 'Connected', speaking: 'speaking with' },
  ended: { label: 'Ended', speaking: 'spoke with' },
}

export default function CallCard() {
  const { currentCall, transcriptions, callEvents, hangUp, sendDtmf, callCardData } = useCall()
  const [isExpanded, setIsExpanded] = useState(false)
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

  // Active call view (pending, ringing, answered, or ended waiting for data)
  const status = statusConfig[currentCall.status] || statusConfig.ended

  // Build transcript turns from ASR (them) and agent_speech events (our agent)
  const asrTurns = transcriptions.map(t => ({
    speaker: 'them' as const,
    text: t.content,
    timestamp: t.created_at,
    confidence: t.confidence
  }))

  const agentSpeechEvents = callEvents.filter(e => e.event_type === 'agent_speech')
  const agentTurns = agentSpeechEvents.map(e => ({
    speaker: 'agent' as const,
    text: e.description || '',
    timestamp: e.created_at,
    confidence: null as number | null
  }))

  const transcriptTurns = [...asrTurns, ...agentTurns]
    .filter(t => t.text && t.text.trim().length > 0)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

  // Extract contact name (use phone number as fallback)
  const contactName = currentCall.phone_number

  return (
    // Call Mode artifact container - distinct from chat bubbles
    <div className="bg-slate-50 rounded-2xl border-2 border-slate-200 overflow-hidden w-full max-w-sm shadow-sm">
      {/* Mode Header - clearly identifies this as a Call artifact */}
      <div className="bg-slate-100 px-4 py-2 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-teal-500 flex items-center justify-center">
            <CallIcon className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-700">
                Live Call
              </span>
              <span className="text-slate-400">·</span>
              <span className="text-sm text-slate-600 truncate">
                OneCalla {status.speaking} {contactName}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              You are viewing the conversation. You are not on the line.
            </p>
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="px-4 py-2 flex items-center justify-between border-b border-slate-200 bg-white">
        <div className="flex items-center gap-2">
          {/* Pulsing status indicator */}
          <div className="relative">
            <span className={`w-2 h-2 rounded-full block ${
              currentCall.status === 'answered' ? 'bg-teal-500' :
              currentCall.status === 'ended' ? 'bg-gray-400' : 'bg-orange-500'
            }`} />
            {currentCall.status !== 'ended' && (
              <span className={`absolute inset-0 w-2 h-2 rounded-full animate-ping ${
                currentCall.status === 'answered' ? 'bg-teal-500' : 'bg-orange-500'
              }`} />
            )}
          </div>
          <span className={`text-sm font-medium ${
            currentCall.status === 'answered' ? 'text-teal-600' :
            currentCall.status === 'ended' ? 'text-gray-500' : 'text-orange-600'
          }`}>
            {currentCall.status === 'answered' ? (isListening ? 'Listening' : 'Speaking') : status.label}
          </span>
        </div>
        {currentCall.status === 'answered' && (
          <span className="text-slate-500 font-mono text-sm">{timeDisplay}</span>
        )}
      </div>

      {/* Live Transcript - two-column conversation view */}
      {currentCall.status === 'answered' && (
        <div className="px-4 py-3 bg-white border-b border-slate-200">
          <CallTranscriptView
            turns={transcriptTurns}
            otherPartyName={contactName}
            maxHeight="160px"
            isLive={true}
          />
        </div>
      )}

      {/* Status messages for non-connected states */}
      {currentCall.status === 'pending' && (
        <div className="px-4 py-6 text-center bg-white">
          <div className="w-8 h-8 border-2 border-slate-300 border-t-teal-500 rounded-full animate-spin mx-auto mb-2" />
          <div className="text-sm text-slate-500">Initiating call...</div>
        </div>
      )}

      {currentCall.status === 'ringing' && (
        <div className="px-4 py-6 text-center bg-white">
          <div className="flex justify-center gap-1 mb-2">
            <span className="w-2 h-2 bg-teal-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 bg-teal-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 bg-teal-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <div className="text-sm text-slate-500">Waiting for answer...</div>
        </div>
      )}

      {/* Controls */}
      {currentCall.status !== 'ended' && (
        <div className="px-4 py-3 bg-slate-50 space-y-2">
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
                    ? 'bg-teal-500 text-white'
                    : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-100'
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
                    ? 'bg-teal-500 text-white'
                    : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-100'
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
                  className="min-h-[44px] bg-white hover:bg-slate-100 border border-slate-200 rounded-xl text-lg font-medium transition-all duration-150"
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
        <>
          {/* Show transcript we captured during the call */}
          {transcriptTurns.length > 0 && (
            <div className="px-4 py-3 bg-white border-b border-slate-200">
              <CallTranscriptView
                turns={transcriptTurns}
                otherPartyName={contactName}
                maxHeight="180px"
                isLive={false}
              />
            </div>
          )}
          {/* Loading indicator for AI summary */}
          <div className="px-4 py-3 bg-slate-50">
            <div className="flex items-center gap-2 text-slate-500">
              <div className="w-4 h-4 border-2 border-slate-300 border-t-teal-500 rounded-full animate-spin" />
              <span className="text-sm">Generating summary...</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

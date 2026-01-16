import { useState, useEffect } from 'react'
import { useCall } from '../../hooks/useCall'
import { useAudioStream } from '../../hooks/useAudioStream'
import CallCardExpanded from './CallCardExpanded'
import CallTranscriptView from './CallTranscriptView'
import CallRecapCard from './CallRecapCard'
import TranscriptOnlyView from './TranscriptOnlyView'
import type { CallCardStatus } from '../../lib/types'

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

// Map call outcome to CallCardStatus
function mapOutcomeToStatus(outcome: string | null, wasAnswered: boolean): CallCardStatus {
  if (!outcome) {
    return wasAnswered ? 'completed' : 'failed'
  }
  switch (outcome) {
    case 'completed': return 'completed'
    case 'voicemail': return 'voicemail'
    case 'busy': return 'busy'
    case 'no_answer': return 'no_answer'
    case 'declined': return 'failed'
    case 'cancelled': return 'canceled'
    default: return wasAnswered ? 'completed' : 'failed'
  }
}

export default function CallCard() {
  const {
    currentCall,
    transcriptions,
    callEvents,
    hangUp,
    sendDtmf,
    callCardData,
    summaryState,
    summaryRequestedAt,
    summaryError,
    retrySummary,
  } = useCall()

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

  // If call ended and user wants expanded view
  if (currentCall.status === 'ended' && isExpanded) {
    // If we have full callCardData, show the rich expanded view
    if (callCardData) {
      return <CallCardExpanded data={callCardData} onCollapse={() => setIsExpanded(false)} />
    }
    // Otherwise show transcript-only view (works even when AI summary fails)
    return (
      <TranscriptOnlyView
        phoneNumber={currentCall.phone_number}
        endedAt={currentCall.ended_at}
        turns={transcriptTurns}
        onClose={() => setIsExpanded(false)}
      />
    )
  }

  // If call ended - show recap card with progressive loading
  if (currentCall.status === 'ended') {
    // Calculate duration from call data
    let callDuration: number | null = null
    if (currentCall.started_at && currentCall.ended_at) {
      callDuration = Math.round(
        (new Date(currentCall.ended_at).getTime() - new Date(currentCall.started_at).getTime()) / 1000
      )
    }

    // Determine outcome status
    const wasAnswered = currentCall.started_at !== null
    const outcomeStatus = mapOutcomeToStatus(currentCall.outcome ?? null, wasAnswered)

    return (
      <CallRecapCard
        phoneNumber={currentCall.phone_number}
        outcome={outcomeStatus}
        duration={callDuration}
        endedAt={currentCall.ended_at}
        transcriptTurns={transcriptTurns}
        callCardData={callCardData}
        summaryState={summaryState}
        summaryRequestedAt={summaryRequestedAt}
        summaryError={summaryError}
        onRetry={retrySummary}
        onExpand={() => setIsExpanded(true)}
      />
    )
  }

  // Active call view (pending, ringing, answered)
  const status = statusConfig[currentCall.status] || statusConfig.ended
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
              currentCall.status === 'answered' ? 'bg-teal-500' : 'bg-orange-500'
            }`} />
            <span className={`absolute inset-0 w-2 h-2 rounded-full animate-ping ${
              currentCall.status === 'answered' ? 'bg-teal-500' : 'bg-orange-500'
            }`} />
          </div>
          <span className={`text-sm font-medium ${
            currentCall.status === 'answered' ? 'text-teal-600' : 'text-orange-600'
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
    </div>
  )
}

import { useRef, useEffect, useState } from 'react'
import type { TranscriptTurn } from '../../lib/types'
import { ROLE_COLORS } from '../../lib/types'

interface CallTranscriptViewProps {
  turns: TranscriptTurn[]
  otherPartyName: string
  maxHeight?: string
  highlightValues?: string[]
  isLive?: boolean
}

// OneCalla icon - small logo/badge
function OneCallaIcon() {
  return (
    <div className="w-5 h-5 rounded-full bg-teal-500 flex items-center justify-center flex-shrink-0">
      <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
      </svg>
    </div>
  )
}

// Phone icon for other party
function PhoneIcon() {
  return (
    <div className="w-5 h-5 rounded-full bg-gray-400 flex items-center justify-center flex-shrink-0">
      <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
      </svg>
    </div>
  )
}

// Highlight text if it matches any highlight values
function highlightText(text: string, highlightValues: string[]): React.ReactNode {
  if (!highlightValues.length) return text

  let result = text
  for (const value of highlightValues) {
    if (value && text.toLowerCase().includes(value.toLowerCase())) {
      const regex = new RegExp(`(${value})`, 'gi')
      result = result.replace(regex, '**$1**')
    }
  }

  // Convert **text** to bold spans
  const parts = result.split(/\*\*(.*?)\*\*/g)
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i} className="font-semibold">{part}</strong> : part
  )
}

export default function CallTranscriptView({
  turns,
  otherPartyName,
  maxHeight = '256px',
  highlightValues = [],
  isLive = false
}: CallTranscriptViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [userScrolled, setUserScrolled] = useState(false)

  // Auto-scroll to bottom when new messages arrive (unless user scrolled up)
  useEffect(() => {
    if (scrollRef.current && !userScrolled) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [turns, userScrolled])

  // Detect user scroll
  const handleScroll = () => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50
    setUserScrolled(!isAtBottom)
  }

  const jumpToLatest = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      setUserScrolled(false)
    }
  }

  if (turns.length === 0) {
    return (
      <div className="text-sm text-gray-400 text-center py-4 italic">
        {isLive ? 'Waiting for conversation...' : 'No transcript available'}
      </div>
    )
  }

  // Group consecutive turns by speaker for cleaner display
  const groupedTurns: Array<{ speaker: 'agent' | 'them'; turns: TranscriptTurn[] }> = []
  for (const turn of turns) {
    const lastGroup = groupedTurns[groupedTurns.length - 1]
    if (lastGroup && lastGroup.speaker === turn.speaker) {
      lastGroup.turns.push(turn)
    } else {
      groupedTurns.push({ speaker: turn.speaker, turns: [turn] })
    }
  }

  return (
    <div className="relative">
      {/* Two-column header */}
      <div className="flex justify-between text-xs font-medium uppercase tracking-wide mb-2 px-1">
        <div className="flex items-center gap-1.5 text-gray-500">
          <PhoneIcon />
          <span>{otherPartyName}</span>
        </div>
        <div className="flex items-center gap-1.5 text-teal-600">
          <span>OneCalla</span>
          <OneCallaIcon />
        </div>
      </div>

      {/* Transcript area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="overflow-y-auto space-y-3"
        style={{ maxHeight }}
      >
        {groupedTurns.map((group, groupIndex) => {
          const isAgent = group.speaker === 'agent'

          return (
            <div
              key={groupIndex}
              className={`flex flex-col gap-1 ${isAgent ? 'items-end' : 'items-start'}`}
            >
              {group.turns.map((turn, turnIndex) => (
                <div
                  key={turnIndex}
                  className={`max-w-[85%] px-3 py-2 text-sm ${
                    isAgent
                      ? `${ROLE_COLORS.onecalla_call.bubble} ${ROLE_COLORS.onecalla_call.text} rounded-2xl rounded-br-md`
                      : `${ROLE_COLORS.other_party.bubble} ${ROLE_COLORS.other_party.text} rounded-2xl rounded-bl-md`
                  }`}
                >
                  {highlightText(turn.text, highlightValues)}
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {/* Jump to latest button */}
      {userScrolled && isLive && (
        <button
          onClick={jumpToLatest}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 bg-gray-800 text-white text-xs rounded-full shadow-lg hover:bg-gray-700 transition-colors"
        >
          Jump to latest
        </button>
      )}
    </div>
  )
}

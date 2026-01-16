import type { TranscriptTurn } from '../../lib/types'

interface TranscriptViewProps {
  turns: TranscriptTurn[]
  highlightValues?: string[]  // Values to bold in transcript
  maxHeight?: string
}

export default function TranscriptView({ turns, highlightValues = [], maxHeight = '256px' }: TranscriptViewProps) {
  if (turns.length === 0) {
    return (
      <div className="text-center py-4 text-gray-500 text-sm">
        No transcript available
      </div>
    )
  }

  // Function to highlight values in text
  const highlightText = (text: string) => {
    if (highlightValues.length === 0) return text

    let result = text
    for (const value of highlightValues) {
      if (value && text.toLowerCase().includes(value.toLowerCase())) {
        const regex = new RegExp(`(${value})`, 'gi')
        result = result.replace(regex, '<strong class="font-semibold text-blue-600">$1</strong>')
      }
    }
    return result
  }

  return (
    <div className="space-y-2 overflow-y-auto" style={{ maxHeight }}>
      {turns.map((turn, index) => {
        const isAgent = turn.speaker === 'agent'
        const speakerLabel = isAgent ? 'OneCalla' : 'Them'

        return (
          <div key={index} className={`flex ${isAgent ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] ${isAgent ? 'order-2' : 'order-1'}`}>
              <div className={`text-xs mb-0.5 ${isAgent ? 'text-right text-blue-600' : 'text-left text-gray-500'}`}>
                {speakerLabel}
              </div>
              <div
                className={`px-3 py-2 rounded-2xl text-sm ${
                  isAgent
                    ? 'bg-blue-500 text-white rounded-br-md'
                    : 'bg-gray-100 text-gray-900 rounded-bl-md'
                }`}
              >
                <span
                  dangerouslySetInnerHTML={{ __html: highlightText(turn.text) }}
                />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

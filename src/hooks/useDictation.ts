import { useState, useCallback, useRef, useEffect } from 'react'

/**
 * Web Speech API Dictation Hook
 * 
 * Browser Support:
 * - Chrome/Edge: Full support via webkitSpeechRecognition
 * - Safari: Partial support (iOS 14.5+, macOS 11.3+)
 * - Firefox: Not supported (would need MediaRecorder + Whisper fallback)
 * 
 * Fallback Plan:
 * If Web Speech API is not available, this hook returns isSupported=false.
 * A future enhancement could add MediaRecorder capture + server-side Whisper transcription.
 */

interface UseDictationOptions {
  onTranscript?: (text: string, isFinal: boolean) => void
  onError?: (error: string) => void
  language?: string
  continuous?: boolean
}

interface UseDictationReturn {
  isListening: boolean
  isSupported: boolean
  interimTranscript: string
  startListening: () => void
  stopListening: () => void
  toggleListening: () => void
}

// Type declarations for Web Speech API
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList
  resultIndex: number
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string
  message?: string
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
  onstart: ((this: SpeechRecognition, ev: Event) => void) | null
  onend: ((this: SpeechRecognition, ev: Event) => void) | null
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition
    webkitSpeechRecognition?: new () => SpeechRecognition
  }
}

export function useDictation(options: UseDictationOptions = {}): UseDictationReturn {
  const { onTranscript, onError, language = 'en-US', continuous = true } = options

  const [isListening, setIsListening] = useState(false)
  const [interimTranscript, setInterimTranscript] = useState('')
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const isStoppingRef = useRef(false)

  // Check browser support
  const isSupported = typeof window !== 'undefined' && 
    (!!window.SpeechRecognition || !!window.webkitSpeechRecognition)

  // Initialize recognition instance
  useEffect(() => {
    if (!isSupported) return

    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognitionAPI) return

    const recognition = new SpeechRecognitionAPI()
    recognition.continuous = continuous
    recognition.interimResults = true
    recognition.lang = language

    recognition.onstart = () => {
      setIsListening(true)
      isStoppingRef.current = false
    }

    recognition.onend = () => {
      setIsListening(false)
      setInterimTranscript('')
      
      // Auto-restart if we didn't intentionally stop (handles Chrome's auto-stop)
      if (!isStoppingRef.current && recognitionRef.current) {
        // Small delay to prevent rapid restart loops
        setTimeout(() => {
          if (!isStoppingRef.current && recognitionRef.current) {
            try {
              recognitionRef.current.start()
            } catch {
              // Ignore errors from rapid start/stop
            }
          }
        }, 100)
      }
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = ''
      let final = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const transcript = result[0].transcript

        if (result.isFinal) {
          final += transcript
        } else {
          interim += transcript
        }
      }

      setInterimTranscript(interim)

      if (final) {
        onTranscript?.(final, true)
      } else if (interim) {
        onTranscript?.(interim, false)
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Speech recognition error:', event.error)
      
      // Handle specific errors
      switch (event.error) {
        case 'not-allowed':
        case 'permission-denied':
          onError?.('Microphone access denied. Enable it in your browser settings.')
          break
        case 'no-speech':
          // This is normal - user was silent, don't show error
          break
        case 'network':
          onError?.('Network error. Please check your connection.')
          break
        case 'aborted':
          // User or system aborted, not an error
          break
        default:
          onError?.(`Dictation error: ${event.error}`)
      }

      // Stop on fatal errors
      if (['not-allowed', 'permission-denied', 'service-not-allowed'].includes(event.error)) {
        isStoppingRef.current = true
        setIsListening(false)
      }
    }

    recognitionRef.current = recognition

    return () => {
      if (recognitionRef.current) {
        isStoppingRef.current = true
        try {
          recognitionRef.current.abort()
        } catch {
          // Ignore
        }
        recognitionRef.current = null
      }
    }
  }, [isSupported, language, continuous, onTranscript, onError])

  const startListening = useCallback(() => {
    if (!isSupported) {
      onError?.('Dictation is not supported in this browser.')
      return
    }

    if (!recognitionRef.current || isListening) return

    isStoppingRef.current = false
    try {
      recognitionRef.current.start()
    } catch (error) {
      // Handle case where recognition is already started
      console.warn('Could not start recognition:', error)
    }
  }, [isSupported, isListening, onError])

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return

    isStoppingRef.current = true
    try {
      recognitionRef.current.stop()
    } catch {
      // Ignore errors from stopping
    }
    setIsListening(false)
    setInterimTranscript('')
  }, [])

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening()
    } else {
      startListening()
    }
  }, [isListening, startListening, stopListening])

  return {
    isListening,
    isSupported,
    interimTranscript,
    startListening,
    stopListening,
    toggleListening,
  }
}

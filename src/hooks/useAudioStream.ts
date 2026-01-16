import { useState, useRef, useCallback, useEffect } from 'react'

interface UseAudioStreamOptions {
  relayUrl: string
  callId: string | null
}

interface UseAudioStreamReturn {
  isConnected: boolean
  isPlaying: boolean
  error: string | null
  connect: () => void
  disconnect: () => void
}

export function useAudioStream({ relayUrl, callId }: UseAudioStreamOptions): UseAudioStreamReturn {
  const [isConnected, setIsConnected] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)

  // Decode PCMU (G.711 μ-law) to PCM
  const decodePCMU = useCallback((base64Data: string): Float32Array => {
    const binaryString = atob(base64Data)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }

    // μ-law to linear PCM conversion table
    const MULAW_BIAS = 33
    const samples = new Float32Array(bytes.length)

    for (let i = 0; i < bytes.length; i++) {
      let mulaw = ~bytes[i] & 0xFF
      const sign = mulaw & 0x80
      const exponent = (mulaw >> 4) & 0x07
      const mantissa = mulaw & 0x0F

      let sample = ((mantissa << 3) + MULAW_BIAS) << exponent
      sample -= MULAW_BIAS

      if (sign !== 0) {
        sample = -sample
      }

      // Normalize to -1.0 to 1.0
      samples[i] = sample / 32768.0
    }

    return samples
  }, [])

  // Play audio samples
  const playAudio = useCallback((samples: Float32Array, sampleRate: number) => {
    if (!audioContextRef.current || !gainNodeRef.current) return

    const buffer = audioContextRef.current.createBuffer(1, samples.length, sampleRate)
    buffer.getChannelData(0).set(samples)

    const source = audioContextRef.current.createBufferSource()
    source.buffer = buffer
    source.connect(gainNodeRef.current)
    source.start()

    setIsPlaying(true)
  }, [])

  const connect = useCallback(() => {
    if (!callId || !relayUrl) {
      setError('Missing call ID or relay URL')
      return
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return // Already connected
    }

    setError(null)

    try {
      // Initialize Web Audio API
      audioContextRef.current = new AudioContext({ sampleRate: 8000 })
      gainNodeRef.current = audioContextRef.current.createGain()
      gainNodeRef.current.connect(audioContextRef.current.destination)
      gainNodeRef.current.gain.value = 1.0

      // Connect to relay server
      const wsUrl = `${relayUrl}?call_id=${callId}&type=browser`
      wsRef.current = new WebSocket(wsUrl)

      wsRef.current.onopen = () => {
        setIsConnected(true)
      }

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)

          if (data.type === 'audio' && data.payload) {
            const samples = decodePCMU(data.payload)
            playAudio(samples, 8000)
          } else if (data.type === 'stop') {
            setIsPlaying(false)
          }
        } catch (e) {
          console.error('Error processing audio message:', e)
        }
      }

      wsRef.current.onclose = () => {
        setIsConnected(false)
        setIsPlaying(false)
      }

      wsRef.current.onerror = () => {
        setError('Connection error')
        setIsConnected(false)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect')
    }
  }, [callId, relayUrl, decodePCMU, playAudio])

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    setIsConnected(false)
    setIsPlaying(false)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  return {
    isConnected,
    isPlaying,
    error,
    connect,
    disconnect,
  }
}

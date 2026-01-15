/**
 * CallSession - Manages a single phone call's connection to OpenAI Realtime API
 *
 * Handles:
 * - OpenAI Realtime WebSocket connection
 * - Audio bridging between Telnyx and OpenAI
 * - Transcript capture
 * - Session state management
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.47.0"
import { config } from "./config.ts"
import { AudioConverter } from "./audio.ts"

interface SessionCallbacks {
  onTranscript: (speaker: "agent" | "remote", text: string) => void
  onError: (error: Error) => void
  onEnd: () => void
}

interface CallContext {
  intent_purpose?: string
  company_name?: string
  intent_category?: string
  gathered_info?: Record<string, string>
}

export class CallSession {
  private callId: string
  private supabase: SupabaseClient
  private callbacks: SessionCallbacks

  private openaiWs: WebSocket | null = null
  private telnyxWs: WebSocket | null = null
  private audioConverter: AudioConverter

  private isConnected = false
  private callContext: CallContext | null = null

  constructor(callId: string, supabase: SupabaseClient, callbacks: SessionCallbacks) {
    this.callId = callId
    this.supabase = supabase
    this.callbacks = callbacks
    this.audioConverter = new AudioConverter()
  }

  /**
   * Connect to OpenAI Realtime API
   */
  async connectToOpenAI(): Promise<void> {
    console.log(`[Session ${this.callId}] Connecting to OpenAI Realtime...`)

    // Load call context from database
    await this.loadCallContext()

    return new Promise((resolve, reject) => {
      const url = `wss://api.openai.com/v1/realtime?model=${config.OPENAI_REALTIME_MODEL}`

      this.openaiWs = new WebSocket(url, {
        headers: {
          "Authorization": `Bearer ${config.OPENAI_API_KEY}`,
          "OpenAI-Beta": "realtime=v1",
        },
      })

      const timeout = setTimeout(() => {
        reject(new Error("OpenAI connection timeout"))
      }, 15000)

      this.openaiWs.onopen = () => {
        clearTimeout(timeout)
        console.log(`[Session ${this.callId}] OpenAI connected`)
        this.isConnected = true

        // Configure the session
        this.configureSession()
        resolve()
      }

      this.openaiWs.onmessage = (event) => {
        this.handleOpenAIMessage(event.data)
      }

      this.openaiWs.onerror = (error) => {
        clearTimeout(timeout)
        console.error(`[Session ${this.callId}] OpenAI error:`, error)
        this.callbacks.onError(new Error("OpenAI connection error"))
        reject(error)
      }

      this.openaiWs.onclose = (event) => {
        console.log(`[Session ${this.callId}] OpenAI disconnected:`, event.code, event.reason)
        this.isConnected = false
        this.callbacks.onEnd()
      }
    })
  }

  /**
   * Load call context from database
   */
  private async loadCallContext(): Promise<void> {
    const { data } = await this.supabase
      .from("call_contexts")
      .select("*")
      .eq("call_id", this.callId)
      .maybeSingle()

    if (data) {
      this.callContext = data
      console.log(`[Session ${this.callId}] Loaded call context:`, data.intent_purpose)
    }
  }

  /**
   * Configure the OpenAI Realtime session
   */
  private configureSession(): void {
    if (!this.openaiWs) return

    // Build context-aware instructions
    let instructions = config.VOICE_AGENT_INSTRUCTIONS

    if (this.callContext) {
      instructions += `\n\n## Current Call Context
Purpose: ${this.callContext.intent_purpose || "General inquiry"}
Company: ${this.callContext.company_name || "Unknown"}
Category: ${this.callContext.intent_category || "General"}
User Info: ${JSON.stringify(this.callContext.gathered_info || {})}`
    }

    // Send session configuration
    this.sendToOpenAI({
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        instructions,
        voice: config.OPENAI_VOICE,
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_transcription: {
          model: "whisper-1"
        },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500
        }
      }
    })

    // Start with a greeting
    this.sendToOpenAI({
      type: "response.create",
      response: {
        modalities: ["text", "audio"],
        instructions: "Start the call with a brief, friendly greeting. Introduce yourself and state why you're calling based on the call context."
      }
    })
  }

  /**
   * Set the Telnyx WebSocket
   */
  setTelnyxSocket(ws: WebSocket): void {
    this.telnyxWs = ws
  }

  /**
   * Handle incoming message from Telnyx
   */
  handleTelnyxMessage(data: string | ArrayBuffer): void {
    try {
      // Telnyx sends JSON messages for media events
      if (typeof data === "string") {
        const message = JSON.parse(data)

        switch (message.event) {
          case "media":
            // Audio data from caller
            this.handleTelnyxAudio(message.media.payload)
            break
          case "start":
            console.log(`[Session ${this.callId}] Telnyx stream started`)
            break
          case "stop":
            console.log(`[Session ${this.callId}] Telnyx stream stopped`)
            this.cleanup()
            break
          default:
            console.log(`[Session ${this.callId}] Telnyx event:`, message.event)
        }
      }
    } catch (error) {
      console.error(`[Session ${this.callId}] Error handling Telnyx message:`, error)
    }
  }

  /**
   * Handle audio data from Telnyx
   */
  private handleTelnyxAudio(base64Audio: string): void {
    if (!this.openaiWs || !this.isConnected) return

    try {
      // Decode base64 mulaw audio from Telnyx
      const mulawAudio = Uint8Array.from(atob(base64Audio), c => c.charCodeAt(0))

      // Convert mulaw to PCM16 and resample 8kHz -> 24kHz
      const pcm16Audio = this.audioConverter.mulawToPcm16(mulawAudio)
      const resampledAudio = this.audioConverter.resample(pcm16Audio, 8000, 24000)

      // Send to OpenAI
      this.sendToOpenAI({
        type: "input_audio_buffer.append",
        audio: btoa(String.fromCharCode(...new Uint8Array(resampledAudio.buffer)))
      })
    } catch (error) {
      console.error(`[Session ${this.callId}] Audio conversion error:`, error)
    }
  }

  /**
   * Handle incoming message from OpenAI
   */
  private handleOpenAIMessage(data: string): void {
    try {
      const event = JSON.parse(data)

      switch (event.type) {
        case "session.created":
          console.log(`[Session ${this.callId}] OpenAI session created`)
          break

        case "session.updated":
          console.log(`[Session ${this.callId}] OpenAI session updated`)
          break

        case "response.audio.delta":
          // Stream audio to Telnyx
          this.sendAudioToTelnyx(event.delta)
          break

        case "response.audio.done":
          console.log(`[Session ${this.callId}] Response audio complete`)
          break

        case "conversation.item.input_audio_transcription.completed":
          // User's speech transcribed
          const userText = event.transcript
          if (userText) {
            console.log(`[Session ${this.callId}] Remote said: ${userText}`)
            this.storeTranscript("remote", userText)
            this.callbacks.onTranscript("remote", userText)
          }
          break

        case "response.audio_transcript.done":
          // AI's speech transcribed
          const aiText = event.transcript
          if (aiText) {
            console.log(`[Session ${this.callId}] AI said: ${aiText}`)
            this.storeTranscript("agent", aiText)
            this.callbacks.onTranscript("agent", aiText)
          }
          break

        case "response.done":
          console.log(`[Session ${this.callId}] Response complete`)
          break

        case "input_audio_buffer.speech_started":
          console.log(`[Session ${this.callId}] User started speaking`)
          break

        case "input_audio_buffer.speech_stopped":
          console.log(`[Session ${this.callId}] User stopped speaking`)
          break

        case "error":
          console.error(`[Session ${this.callId}] OpenAI error:`, event.error)
          this.callbacks.onError(new Error(event.error?.message || "OpenAI error"))
          break

        default:
          // Log other events for debugging
          if (event.type !== "response.audio.delta") {
            console.log(`[Session ${this.callId}] OpenAI event:`, event.type)
          }
      }
    } catch (error) {
      console.error(`[Session ${this.callId}] Error handling OpenAI message:`, error)
    }
  }

  /**
   * Send audio to Telnyx via bidirectional streaming
   */
  private sendAudioToTelnyx(base64Pcm16Audio: string): void {
    if (!this.telnyxWs || this.telnyxWs.readyState !== WebSocket.OPEN) return

    try {
      // Decode PCM16 audio from OpenAI (24kHz)
      const pcm16Audio = new Int16Array(
        Uint8Array.from(atob(base64Pcm16Audio), c => c.charCodeAt(0)).buffer
      )

      // Resample 24kHz -> 8kHz and convert to mulaw
      const resampled = this.audioConverter.resample(pcm16Audio, 24000, 8000)
      const mulawAudio = this.audioConverter.pcm16ToMulaw(resampled)

      // Send to Telnyx using bidirectional streaming format
      // See: https://developers.telnyx.com/docs/v2/media-streaming/bidirectional
      this.telnyxWs.send(JSON.stringify({
        event: "media",
        media: {
          track: "outbound",
          payload: btoa(String.fromCharCode(...mulawAudio))
        }
      }))
    } catch (error) {
      console.error(`[Session ${this.callId}] Error sending audio to Telnyx:`, error)
    }
  }

  /**
   * Store transcript in database
   */
  private async storeTranscript(speaker: "agent" | "remote", content: string): Promise<void> {
    try {
      await this.supabase.from("transcriptions").insert({
        call_id: this.callId,
        speaker,
        content,
        created_at: new Date().toISOString()
      })
    } catch (error) {
      console.error(`[Session ${this.callId}] Error storing transcript:`, error)
    }
  }

  /**
   * Send message to OpenAI
   */
  private sendToOpenAI(message: Record<string, unknown>): void {
    if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
      this.openaiWs.send(JSON.stringify(message))
    }
  }

  /**
   * Cleanup session
   */
  cleanup(): void {
    console.log(`[Session ${this.callId}] Cleaning up`)

    if (this.openaiWs) {
      this.openaiWs.close()
      this.openaiWs = null
    }

    if (this.telnyxWs) {
      this.telnyxWs.close()
      this.telnyxWs = null
    }

    this.isConnected = false
  }
}

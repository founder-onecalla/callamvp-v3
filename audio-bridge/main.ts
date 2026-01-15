/**
 * OneCalla Audio Bridge Server
 *
 * Bridges audio between Telnyx phone calls and OpenAI Realtime API
 * Handles:
 * - Telnyx WebSocket media streams
 * - OpenAI Realtime API WebSocket connections
 * - Audio format conversion (mulaw ↔ PCM16)
 * - Transcript capture and storage
 * - Frontend WebSocket notifications
 *
 * Deploy to Deno Deploy: deployctl deploy --project=onecalla-bridge main.ts
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0"
import { CallSession } from "./session.ts"
import { config } from "./config.ts"

// Active call sessions
const sessions = new Map<string, CallSession>()

// Frontend WebSocket connections (for live transcript updates)
const frontendConnections = new Map<string, Set<WebSocket>>()

// Supabase client
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)

/**
 * Main HTTP/WebSocket server
 */
serve(async (req) => {
  const url = new URL(req.url)
  const path = url.pathname

  // Health check
  if (path === "/" || path === "/health") {
    return new Response(JSON.stringify({
      status: "ok",
      activeSessions: sessions.size,
      timestamp: new Date().toISOString()
    }), {
      headers: { "Content-Type": "application/json" }
    })
  }

  // Telnyx media stream WebSocket
  // URL: /telnyx-stream?call_id=xxx
  if (path === "/telnyx-stream") {
    if (req.headers.get("upgrade") !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 })
    }

    const callId = url.searchParams.get("call_id")
    if (!callId) {
      return new Response("call_id required", { status: 400 })
    }

    const { socket, response } = Deno.upgradeWebSocket(req)

    socket.onopen = async () => {
      console.log(`[Bridge] Telnyx connected for call: ${callId}`)

      // Create new session
      const session = new CallSession(callId, supabase, {
        onTranscript: (speaker, text) => {
          // Notify frontend connections
          notifyFrontend(callId, "transcript", { speaker, text })
        },
        onError: (error) => {
          console.error(`[Bridge] Session error for ${callId}:`, error)
          notifyFrontend(callId, "error", { message: error.message })
        },
        onEnd: () => {
          console.log(`[Bridge] Session ended for ${callId}`)
          sessions.delete(callId)
          notifyFrontend(callId, "ended", {})
        }
      })

      sessions.set(callId, session)

      // Connect to OpenAI Realtime
      await session.connectToOpenAI()

      // Set Telnyx socket
      session.setTelnyxSocket(socket)

      // Log event
      await supabase.from("call_events").insert({
        call_id: callId,
        event_type: "realtime_connected",
        description: "Voice AI connected",
        metadata: { bridge: "openai-realtime" }
      })
    }

    socket.onmessage = (event) => {
      const session = sessions.get(callId)
      if (session) {
        session.handleTelnyxMessage(event.data)
      }
    }

    socket.onclose = () => {
      console.log(`[Bridge] Telnyx disconnected for call: ${callId}`)
      const session = sessions.get(callId)
      if (session) {
        session.cleanup()
        sessions.delete(callId)
      }
    }

    socket.onerror = (error) => {
      console.error(`[Bridge] Telnyx socket error for ${callId}:`, error)
    }

    return response
  }

  // Frontend WebSocket for live updates
  // URL: /frontend?call_id=xxx
  if (path === "/frontend") {
    if (req.headers.get("upgrade") !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 })
    }

    const callId = url.searchParams.get("call_id")
    if (!callId) {
      return new Response("call_id required", { status: 400 })
    }

    const { socket, response } = Deno.upgradeWebSocket(req)

    socket.onopen = () => {
      console.log(`[Bridge] Frontend connected for call: ${callId}`)
      if (!frontendConnections.has(callId)) {
        frontendConnections.set(callId, new Set())
      }
      frontendConnections.get(callId)!.add(socket)
    }

    socket.onclose = () => {
      console.log(`[Bridge] Frontend disconnected for call: ${callId}`)
      frontendConnections.get(callId)?.delete(socket)
    }

    return response
  }

  // Start a call session (called from call-start edge function)
  // POST /start-session
  if (path === "/start-session" && req.method === "POST") {
    try {
      const { call_id, call_context } = await req.json()

      if (!call_id) {
        return new Response(JSON.stringify({ error: "call_id required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        })
      }

      // Pre-create session config (actual session created when Telnyx connects)
      console.log(`[Bridge] Session prepared for call: ${call_id}`)

      return new Response(JSON.stringify({
        success: true,
        stream_url: `wss://${config.BRIDGE_HOST}/telnyx-stream?call_id=${call_id}`
      }), {
        headers: { "Content-Type": "application/json" }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      })
    }
  }

  return new Response("Not found", { status: 404 })
}, { port: config.PORT })

/**
 * Notify frontend connections of events
 */
function notifyFrontend(callId: string, event: string, data: Record<string, unknown>) {
  const connections = frontendConnections.get(callId)
  if (!connections) return

  const message = JSON.stringify({ event, ...data, timestamp: Date.now() })

  for (const ws of connections) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message)
    }
  }
}

console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                    OneCalla Audio Bridge                       ║
╠═══════════════════════════════════════════════════════════════╣
║  Server running on port ${config.PORT}                              ║
║                                                               ║
║  Endpoints:                                                   ║
║  • GET  /health         - Health check                        ║
║  • WS   /telnyx-stream  - Telnyx media stream                 ║
║  • WS   /frontend       - Frontend live updates               ║
║  • POST /start-session  - Initialize call session             ║
╚═══════════════════════════════════════════════════════════════╝
`)

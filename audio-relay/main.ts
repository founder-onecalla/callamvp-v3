/**
 * Audio Relay Server for Telnyx Media Streaming
 * Deploy to Deno Deploy: https://deno.com/deploy
 *
 * This server:
 * 1. Receives audio from Telnyx via WebSocket
 * 2. Broadcasts to connected browser clients
 */

const clients = new Map<string, Set<WebSocket>>() // callId -> Set of browser WebSockets

Deno.serve({ port: 8000 }, (req) => {
  const url = new URL(req.url)

  // Health check
  if (url.pathname === '/health') {
    return new Response('OK', { status: 200 })
  }

  // WebSocket upgrade required
  if (req.headers.get('upgrade') !== 'websocket') {
    return new Response('WebSocket required', { status: 426 })
  }

  const { socket, response } = Deno.upgradeWebSocket(req)

  // Determine if this is Telnyx or a browser client
  const callId = url.searchParams.get('call_id')
  const clientType = url.searchParams.get('type') || 'browser'

  if (!callId) {
    socket.close(1008, 'call_id required')
    return response
  }

  if (clientType === 'telnyx') {
    // This is Telnyx sending audio
    handleTelnyxConnection(socket, callId)
  } else {
    // This is a browser wanting to listen
    handleBrowserConnection(socket, callId)
  }

  return response
})

function handleTelnyxConnection(socket: WebSocket, callId: string) {
  console.log(`Telnyx connected for call: ${callId}`)

  socket.onmessage = (event) => {
    // Telnyx sends JSON messages with audio data
    try {
      const data = JSON.parse(event.data)

      if (data.event === 'media') {
        // Forward audio to all browser clients for this call
        const browserClients = clients.get(callId)
        if (browserClients) {
          const audioMessage = JSON.stringify({
            type: 'audio',
            payload: data.media.payload, // base64 audio
            timestamp: data.media.timestamp,
          })

          browserClients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(audioMessage)
            }
          })
        }
      } else if (data.event === 'start') {
        console.log(`Stream started for call: ${callId}`, data.start)
        // Notify browsers that stream started
        const browserClients = clients.get(callId)
        if (browserClients) {
          browserClients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                type: 'start',
                encoding: data.start?.media_format?.encoding || 'PCMU',
                sampleRate: data.start?.media_format?.sample_rate || 8000
              }))
            }
          })
        }
      } else if (data.event === 'stop') {
        console.log(`Stream stopped for call: ${callId}`)
        // Notify browsers that stream stopped
        const browserClients = clients.get(callId)
        if (browserClients) {
          browserClients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'stop' }))
            }
          })
        }
      }
    } catch (e) {
      console.error('Error parsing Telnyx message:', e)
    }
  }

  socket.onclose = () => {
    console.log(`Telnyx disconnected for call: ${callId}`)
  }

  socket.onerror = (e) => {
    console.error(`Telnyx WebSocket error for call ${callId}:`, e)
  }
}

function handleBrowserConnection(socket: WebSocket, callId: string) {
  console.log(`Browser client connected for call: ${callId}`)

  // Add to clients map
  if (!clients.has(callId)) {
    clients.set(callId, new Set())
  }
  clients.get(callId)!.add(socket)

  // Send connection confirmation
  socket.send(JSON.stringify({ type: 'connected', callId }))

  socket.onclose = () => {
    console.log(`Browser client disconnected for call: ${callId}`)
    clients.get(callId)?.delete(socket)
    if (clients.get(callId)?.size === 0) {
      clients.delete(callId)
    }
  }

  socket.onerror = (e) => {
    console.error(`Browser WebSocket error for call ${callId}:`, e)
  }
}

console.log('Audio relay server running on port 8000')

# OneCalla Audio Bridge

Real-time voice AI bridge between Telnyx phone calls and OpenAI Realtime API.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  Telnyx Phone Call                          OpenAI Realtime API             │
│  ┌─────────────┐                            ┌─────────────────┐            │
│  │ Audio In    │───► mulaw 8kHz ────────►   │                 │            │
│  │ (caller)    │      │                     │  GPT-4o         │            │
│  │             │      ▼                     │  Realtime       │            │
│  │             │   [Audio Bridge]           │                 │            │
│  │             │      │                     │                 │            │
│  │ Audio Out   │◄─── pcm16 24kHz ◄──────   │                 │            │
│  │ (to caller) │                            │                 │            │
│  └─────────────┘                            └─────────────────┘            │
│                                                                             │
│                    ┌───────────────┐                                       │
│                    │   Supabase    │◄─── Transcripts stored                │
│                    │   Database    │                                       │
│                    └───────────────┘                                       │
│                                                                             │
│                    ┌───────────────┐                                       │
│                    │   Frontend    │◄─── Live transcript updates           │
│                    │   WebSocket   │                                       │
│                    └───────────────┘                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Setup

### 1. Environment Variables

```bash
# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_REALTIME_MODEL=gpt-4o-realtime-preview
OPENAI_VOICE=alloy  # alloy, echo, shimmer, ash, ballad, coral, sage, verse

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Telnyx
TELNYX_API_KEY=KEY...

# Server
PORT=8000
BRIDGE_HOST=your-bridge.deno.dev
```

### 2. Local Development

```bash
# Run locally
deno run --allow-net --allow-env main.ts

# Or with environment file
deno run --allow-net --allow-env --env=.env main.ts
```

### 3. Deploy to Deno Deploy

```bash
# Install deployctl
deno install -A jsr:@deno/deployctl

# Deploy
deployctl deploy --project=onecalla-bridge main.ts
```

### 4. Configure Telnyx

Update your Telnyx Call Control application to use the bridge for media streaming:

1. Go to Telnyx Portal → Voice → Call Control Applications
2. Set the media streaming URL to: `wss://your-bridge.deno.dev/telnyx-stream`

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/telnyx-stream?call_id=xxx` | WS | Telnyx media stream connection |
| `/frontend?call_id=xxx` | WS | Frontend live transcript updates |
| `/start-session` | POST | Initialize a call session |

## Audio Conversion

The bridge handles audio format conversion between:
- **Telnyx**: mulaw (G.711 μ-law), 8kHz, mono
- **OpenAI**: PCM16 (linear), 24kHz, mono

## Latency

Expected end-to-end latency: **300-600ms**

Components:
- Telnyx → Bridge: ~50ms
- Audio conversion: ~10ms
- OpenAI processing: ~200-400ms
- Bridge → Telnyx: ~50ms

## Troubleshooting

### "OpenAI connection timeout"
- Check your OPENAI_API_KEY has Realtime API access
- Verify the model name is correct

### "No audio from caller"
- Ensure Telnyx media streaming is configured correctly
- Check the stream URL includes the call_id parameter

### "Robotic/choppy audio"
- Audio sample rate conversion issue
- Check network latency between bridge and APIs

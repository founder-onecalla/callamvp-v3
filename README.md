# OneCalla

An AI-powered phone call assistant that helps you make and manage phone calls through natural language conversation.

## Features

- 🤖 **AI Chat Interface** - Describe what you need and the AI will handle the call
- 📞 **Phone Calls via Telnyx** - Make real phone calls to any number
- 🎙️ **Real-time Transcription** - See live transcripts of your calls
- 🧠 **Voice AI Agent** - OpenAI Realtime API handles conversations on your behalf
- 💬 **Conversation History** - Track and revisit past chats and calls
- 🔐 **Secure Authentication** - Supabase Auth with Row Level Security

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS
- **Backend**: Supabase (PostgreSQL, Auth, Edge Functions, Realtime)
- **Telephony**: Telnyx Voice API
- **AI**: OpenAI GPT-4 (chat) + Realtime API (voice)
- **Audio Bridge**: Deno Deploy (media streaming)
- **Deployment**: Vercel (frontend)

## Prerequisites

- Node.js 18+
- npm or yarn
- Supabase account
- Telnyx account with a phone number
- OpenAI API key

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/founder-onecalla/callamvp-v3.git
cd callamvp-v3
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Create a `.env.local` file in the root directory:

```env
# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Audio Bridge (optional - for real-time transcripts)
VITE_AUDIO_BRIDGE_URL=https://your-bridge.deno.dev
```

### 4. Set up Supabase

1. Create a new Supabase project
2. Run the migrations in `supabase/migrations/` in order
3. Deploy Edge Functions:

```bash
supabase functions deploy call-start
supabase functions deploy call-hangup
supabase functions deploy call-dtmf
supabase functions deploy call-summary
supabase functions deploy chat
supabase functions deploy voice-agent
supabase functions deploy webhook-telnyx
```

4. Set Edge Function secrets in the Supabase dashboard:
   - `TELNYX_API_KEY`
   - `TELNYX_CONNECTION_ID`
   - `TELNYX_PHONE_NUMBER`
   - `OPENAI_API_KEY`
   - `AUDIO_RELAY_URL`

### 5. Set up Telnyx

1. Create a Telnyx account and get a phone number
2. Create a Call Control Application
3. Set the webhook URL to: `https://your-project.supabase.co/functions/v1/webhook-telnyx`
4. Note your Connection ID for the environment variables

### 6. Deploy Audio Bridge (Optional)

The audio bridge handles real-time audio streaming between Telnyx and OpenAI. See `audio-bridge/README.md` for deployment instructions.

### 7. Start development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
callamvp-v3/
├── src/
│   ├── components/     # React components
│   │   └── Chat/       # Chat UI components
│   ├── hooks/          # Custom React hooks
│   │   ├── useCall.tsx     # Call management
│   │   ├── useChat.ts      # Chat functionality
│   │   └── useConversations.ts
│   ├── lib/            # Utilities and types
│   │   ├── AuthContext.tsx
│   │   ├── supabase.ts
│   │   └── types.ts
│   └── pages/          # Page components
├── supabase/
│   ├── functions/      # Edge Functions
│   │   ├── call-start/
│   │   ├── call-hangup/
│   │   ├── call-dtmf/
│   │   ├── call-summary/
│   │   ├── chat/
│   │   ├── voice-agent/
│   │   └── webhook-telnyx/
│   └── migrations/     # Database migrations
├── audio-bridge/       # Deno audio bridge server
└── audio-relay/        # Audio relay server
```

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

## Database Schema

The app uses these main tables:

- `calls` - Phone call records
- `transcriptions` - Call transcripts
- `messages` - Chat messages
- `conversations` - Chat conversation threads
- `call_events` - Call status events
- `call_contexts` - Pre-call intelligence data

All tables have Row Level Security (RLS) enabled.

## Deployment

### Frontend (Vercel)

```bash
vercel --prod
```

Or connect your GitHub repository to Vercel for automatic deployments.

### Edge Functions (Supabase)

```bash
supabase functions deploy --all
```

### Audio Bridge (Deno Deploy)

```bash
cd audio-bridge
deployctl deploy --project=onecalla-bridge main.ts
```

## License

MIT

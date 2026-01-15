export interface User {
  id: string
  email: string
}

export interface Call {
  id: string
  user_id: string
  telnyx_call_id: string | null
  phone_number: string
  status: 'pending' | 'ringing' | 'answered' | 'ended'
  direction: 'outbound' | 'inbound'
  started_at: string | null
  ended_at: string | null
  created_at: string
  outcome?: string | null // 'completed', 'voicemail', 'busy', 'no_answer', 'failed'
  amd_result?: string | null // 'human', 'machine', 'not_sure', etc.
  summary?: string | null // AI-generated summary of the call
  duration_seconds?: number | null
}

export interface Transcription {
  id: string
  call_id: string
  speaker: 'user' | 'remote' | 'agent'
  content: string
  confidence: number | null
  created_at: string
}

export interface Message {
  id: string
  user_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  call_id: string | null
  conversation_id: string | null
  created_at: string
}

export interface Conversation {
  id: string
  user_id: string
  title: string
  created_at: string
  updated_at: string
}

export interface CallEvent {
  id: string
  call_id: string
  event_type: 'status_change' | 'dtmf_sent' | 'dtmf_received' | 'ivr_navigation' | 'transcription' | 'error'
  description: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface ChatFunction {
  name: string
  arguments: Record<string, unknown>
}

export interface Database {
  public: {
    Tables: {
      calls: {
        Row: Call
        Insert: Omit<Call, 'id' | 'created_at'>
        Update: Partial<Call>
      }
      transcriptions: {
        Row: Transcription
        Insert: Omit<Transcription, 'id' | 'created_at'>
        Update: Partial<Transcription>
      }
      messages: {
        Row: Message
        Insert: Omit<Message, 'id' | 'created_at'>
        Update: Partial<Message>
      }
      conversations: {
        Row: Conversation
        Insert: Omit<Conversation, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Conversation, 'id'>>
      }
    }
  }
}

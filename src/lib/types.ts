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
}

export interface Transcription {
  id: string
  call_id: string
  speaker: 'user' | 'remote'
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
    }
  }
}

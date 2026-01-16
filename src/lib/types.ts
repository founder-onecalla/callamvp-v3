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
  closing_state?: 'active' | 'closing_said' // For mutual goodbye mechanism
  closing_started_at?: string | null // When AI said goodbye
  // Recap state - single source of truth
  recap_status?: 'recap_ready' | 'recap_pending' | 'recap_failed_transient' | 'recap_failed_permanent'
  recap_error_code?: string | null
  recap_last_attempt_at?: string | null
  recap_attempt_count?: number
  // Pipeline state for debugging
  pipeline_checkpoints?: Record<string, string | null>
  last_activity_at?: string | null
  silence_started_at?: string | null
  reprompt_count?: number
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
  event_type: 'status_change' | 'dtmf_sent' | 'dtmf_received' | 'ivr_navigation' | 'transcription' | 'error' | 'agent_speech' | 'hangup' | 'connected' | 'ringing' | 'ended' | 'mutual_goodbye' | 'closing_aborted' | 'streaming' | 'realtime_api' | 'checkpoint' | 'transcription_started'
  description: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface ChatFunction {
  name: string
  arguments: Record<string, unknown>
}

// CallCard Data Contract
export type CallCardStatus = 'in_progress' | 'completed' | 'no_answer' | 'busy' | 'failed' | 'voicemail' | 'canceled'
export type ConfidenceLevel = 'high' | 'medium' | 'low'

// ============================================================================
// RECAP STATE MODEL - Single source of truth, mutually exclusive states
// ============================================================================
export type RecapStatus =
  | 'recap_ready'             // Full recap available, show content
  | 'recap_pending'           // Generating, show spinner
  | 'recap_failed_transient'  // Temporary failure, can retry
  | 'recap_failed_permanent'  // Permanent failure, no retry

export interface RecapState {
  status: RecapStatus
  errorCode?: string          // For debugging/analytics
  errorMessage?: string       // Internal only, not shown to user
  lastAttemptAt?: string      // ISO timestamp
  attemptCount: number
}

// ============================================================================
// CALL PIPELINE CHECKPOINTS - For diagnosing call failures
// ============================================================================
export type CallCheckpoint =
  | 'call_started'
  | 'call_answered'
  | 'first_tts_started'
  | 'first_tts_completed'
  | 'first_audio_received'
  | 'first_asr_partial'
  | 'first_asr_final'
  | 'agent_decision_made'
  | 'second_tts_started'
  | 'call_ended'

export interface CallPipelineState {
  checkpoints: Record<CallCheckpoint, string | null> // ISO timestamp or null
  lastActivity: string // ISO timestamp
  silenceStartedAt: string | null // When we started waiting for response
  repromptCount: number
}

export interface CallCardTakeaway {
  label: string
  value: string
  when?: string
  confidence: ConfidenceLevel
}

export interface TranscriptTurn {
  speaker: 'agent' | 'them'
  text: string
  timestamp: string
  confidence: number | null
}

export interface TimelineEvent {
  t: string
  type: string
  description: string
}

export interface CallCardData {
  callId: string
  contact: {
    name: string | null
    phone: string
  }
  createdAt: string
  startedAt: string | null
  connectedAt: string | null
  endedAt: string | null
  durationSec: number | null
  status: CallCardStatus
  endReason: {
    label: string
    code: string
  } | null
  goal: string | null
  outcome: {
    sentence: string
    takeaways: CallCardTakeaway[]
    confidence: ConfidenceLevel
    warnings: string[]
  } | null
  transcript: {
    turns: TranscriptTurn[]
    hasFullTranscript: boolean
  }
  media: {
    hasRecording: boolean
    recordingUrl: string | null
  }
  debug: {
    timeline: TimelineEvent[]
    provider: {
      name: string
      callControlId: string | null
    }
    endReasonCode: string | null
  }
}

// Status label and color mappings
export const STATUS_LABELS: Record<CallCardStatus, string> = {
  'in_progress': 'In progress',
  'completed': 'Completed',
  'no_answer': 'No answer',
  'busy': 'Busy',
  'failed': 'Failed',
  'voicemail': 'Voicemail',
  'canceled': 'Canceled'
}

export const STATUS_COLORS: Record<CallCardStatus, { bg: string; text: string; dot: string }> = {
  'in_progress': { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' },
  'completed': { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
  'no_answer': { bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500' },
  'busy': { bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500' },
  'failed': { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' },
  'voicemail': { bg: 'bg-purple-100', text: 'text-purple-700', dot: 'bg-purple-500' },
  'canceled': { bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-500' }
}

// Role visual system - three distinct roles
// User: blue (main chat only, right-aligned) - NEVER appears in call card
// OneCalla: teal (call card), light gray (main chat) - product identity
// Other Party: neutral gray - external caller
export const ROLE_COLORS = {
  // User in main chat - blue (reserved, never in call card)
  user: {
    bubble: 'bg-blue-500',
    text: 'text-white',
  },
  // OneCalla in main chat - light neutral
  onecalla_chat: {
    bubble: 'bg-gray-100',
    text: 'text-gray-900',
  },
  // OneCalla in call card - teal (distinct from user blue)
  onecalla_call: {
    bubble: 'bg-teal-500',
    text: 'text-white',
    label: 'text-teal-600',
  },
  // Other party in call card - neutral gray
  other_party: {
    bubble: 'bg-gray-200',
    text: 'text-gray-900',
    label: 'text-gray-500',
  },
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

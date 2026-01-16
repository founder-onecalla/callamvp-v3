export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      call_contexts: {
        Row: {
          call_id: string | null
          company_name: string | null
          created_at: string | null
          gathered_info: Json | null
          id: string
          intent_category: string | null
          intent_purpose: string | null
          ivr_path_id: string | null
          status: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          call_id?: string | null
          company_name?: string | null
          created_at?: string | null
          gathered_info?: Json | null
          id?: string
          intent_category?: string | null
          intent_purpose?: string | null
          ivr_path_id?: string | null
          status?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          call_id?: string | null
          company_name?: string | null
          created_at?: string | null
          gathered_info?: Json | null
          id?: string
          intent_category?: string | null
          intent_purpose?: string | null
          ivr_path_id?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_contexts_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_contexts_ivr_path_id_fkey"
            columns: ["ivr_path_id"]
            isOneToOne: false
            referencedRelation: "ivr_paths"
            referencedColumns: ["id"]
          },
        ]
      }
      call_events: {
        Row: {
          call_id: string
          created_at: string | null
          description: string | null
          event_type: string
          id: string
          metadata: Json | null
        }
        Insert: {
          call_id: string
          created_at?: string | null
          description?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
        }
        Update: {
          call_id?: string
          created_at?: string | null
          description?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "call_events_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
      calls: {
        Row: {
          amd_result: string | null
          closing_started_at: string | null
          closing_state: string | null
          created_at: string | null
          direction: string | null
          duration_seconds: number | null
          ended_at: string | null
          id: string
          inbound_audio_health: Json | null
          last_activity_at: string | null
          outcome: string | null
          phone_number: string
          pipeline_checkpoints: Json | null
          recap_attempt_count: number | null
          recap_error_code: string | null
          recap_last_attempt_at: string | null
          recap_status: string | null
          reprompt_count: number | null
          silence_started_at: string | null
          started_at: string | null
          status: string | null
          summary: string | null
          telnyx_call_id: string | null
          user_id: string
        }
        Insert: {
          amd_result?: string | null
          closing_started_at?: string | null
          closing_state?: string | null
          created_at?: string | null
          direction?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          inbound_audio_health?: Json | null
          last_activity_at?: string | null
          outcome?: string | null
          phone_number: string
          pipeline_checkpoints?: Json | null
          recap_attempt_count?: number | null
          recap_error_code?: string | null
          recap_last_attempt_at?: string | null
          recap_status?: string | null
          reprompt_count?: number | null
          silence_started_at?: string | null
          started_at?: string | null
          status?: string | null
          summary?: string | null
          telnyx_call_id?: string | null
          user_id: string
        }
        Update: {
          amd_result?: string | null
          closing_started_at?: string | null
          closing_state?: string | null
          created_at?: string | null
          direction?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          inbound_audio_health?: Json | null
          last_activity_at?: string | null
          outcome?: string | null
          phone_number?: string
          pipeline_checkpoints?: Json | null
          recap_attempt_count?: number | null
          recap_error_code?: string | null
          recap_last_attempt_at?: string | null
          recap_status?: string | null
          reprompt_count?: number | null
          silence_started_at?: string | null
          started_at?: string | null
          status?: string | null
          summary?: string | null
          telnyx_call_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          created_at: string | null
          id: string
          title: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          title?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          title?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ivr_paths: {
        Row: {
          company_name: string
          created_at: string | null
          department: string | null
          id: string
          last_verified: string | null
          menu_path: Json
          notes: string | null
          operating_hours: string | null
          phone_number: string
          required_info: Json | null
          updated_at: string | null
        }
        Insert: {
          company_name: string
          created_at?: string | null
          department?: string | null
          id?: string
          last_verified?: string | null
          menu_path?: Json
          notes?: string | null
          operating_hours?: string | null
          phone_number: string
          required_info?: Json | null
          updated_at?: string | null
        }
        Update: {
          company_name?: string
          created_at?: string | null
          department?: string | null
          id?: string
          last_verified?: string | null
          menu_path?: Json
          notes?: string | null
          operating_hours?: string | null
          phone_number?: string
          required_info?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          call_id: string | null
          content: string
          conversation_id: string | null
          created_at: string | null
          id: string
          role: string
          user_id: string
        }
        Insert: {
          call_id?: string | null
          content: string
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          role: string
          user_id: string
        }
        Update: {
          call_id?: string | null
          content?: string
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      transcriptions: {
        Row: {
          call_id: string
          confidence: number | null
          content: string
          created_at: string | null
          id: string
          speaker: string | null
        }
        Insert: {
          call_id: string
          confidence?: number | null
          content: string
          created_at?: string | null
          id?: string
          speaker?: string | null
        }
        Update: {
          call_id?: string
          confidence?: number | null
          content?: string
          created_at?: string | null
          id?: string
          speaker?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transcriptions_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
      user_contacts: {
        Row: {
          company: string | null
          created_at: string | null
          id: string
          metadata: Json | null
          name: string
          notes: string | null
          phone_number: string
          type: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          company?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          name: string
          notes?: string | null
          phone_number: string
          type?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          company?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          name?: string
          notes?: string | null
          phone_number?: string
          type?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_memories: {
        Row: {
          category: string | null
          created_at: string | null
          id: string
          key: string
          metadata: Json | null
          updated_at: string | null
          user_id: string
          value: string
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          id?: string
          key: string
          metadata?: Json | null
          updated_at?: string | null
          user_id: string
          value: string
        }
        Update: {
          category?: string | null
          created_at?: string | null
          id?: string
          key?: string
          metadata?: Json | null
          updated_at?: string | null
          user_id?: string
          value?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          created_at: string | null
          default_caller_mode: Database["public"]["Enums"]["caller_mode"] | null
          default_caller_other_name: string | null
          display_name: string | null
          notify_call_completed: boolean | null
          notify_call_failed: boolean | null
          require_sensitive_confirmation: boolean | null
          text_size: Database["public"]["Enums"]["text_size_mode"] | null
          theme: Database["public"]["Enums"]["theme_mode"] | null
          transcript_retention_days: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          default_caller_mode?:
            | Database["public"]["Enums"]["caller_mode"]
            | null
          default_caller_other_name?: string | null
          display_name?: string | null
          notify_call_completed?: boolean | null
          notify_call_failed?: boolean | null
          require_sensitive_confirmation?: boolean | null
          text_size?: Database["public"]["Enums"]["text_size_mode"] | null
          theme?: Database["public"]["Enums"]["theme_mode"] | null
          transcript_retention_days?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          default_caller_mode?:
            | Database["public"]["Enums"]["caller_mode"]
            | null
          default_caller_other_name?: string | null
          display_name?: string | null
          notify_call_completed?: boolean | null
          notify_call_failed?: boolean | null
          require_sensitive_confirmation?: boolean | null
          text_size?: Database["public"]["Enums"]["text_size_mode"] | null
          theme?: Database["public"]["Enums"]["theme_mode"] | null
          transcript_retention_days?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      enforce_transcript_retention: { Args: never; Returns: number }
    }
    Enums: {
      caller_mode: "SELF_NAME" | "OTHER_NAME" | "DONT_DISCLOSE"
      text_size_mode: "NORMAL" | "LARGE"
      theme_mode: "SYSTEM" | "LIGHT" | "DARK"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      caller_mode: ["SELF_NAME", "OTHER_NAME", "DONT_DISCLOSE"],
      text_size_mode: ["NORMAL", "LARGE"],
      theme_mode: ["SYSTEM", "LIGHT", "DARK"],
    },
  },
} as const

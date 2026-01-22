import { createClient } from '@supabase/supabase-js'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

export type Database = {
  public: {
    Tables: {
      coaches: {
        Row: {
          id: string
          user_id: string
          display_name: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          display_name?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          display_name?: string | null
          created_at?: string
        }
      }
      seasons: {
        Row: {
          id: string
          coach_id: string
          name: string
          league_type: string | null
          start_date: string | null
          end_date: string | null
          created_at: string
        }
        Insert: {
          id?: string
          coach_id: string
          name: string
          league_type?: string | null
          start_date?: string | null
          end_date?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          coach_id?: string
          name?: string
          league_type?: string | null
          start_date?: string | null
          end_date?: string | null
          created_at?: string
        }
      }
      teams: {
        Row: {
          id: string
          season_id: string
          coach_id: string
          name: string
          age_group: string | null
          skill_level: string | null
          practice_duration_minutes: number | null
          practice_days: any
          primary_goals: any
          created_at: string
        }
        Insert: {
          id?: string
          season_id: string
          coach_id: string
          name: string
          age_group?: string | null
          skill_level?: string | null
          practice_duration_minutes?: number | null
          practice_days?: any
          primary_goals?: any
          created_at?: string
        }
        Update: {
          id?: string
          season_id?: string
          coach_id?: string
          name?: string
          age_group?: string | null
          skill_level?: string | null
          practice_duration_minutes?: number | null
          practice_days?: any
          primary_goals?: any
          created_at?: string
        }
      }
      players: {
        Row: {
          id: string
          coach_id: string
          name: string
          jersey_number: string | null
          birth_year: number | null
          created_at: string
        }
        Insert: {
          id?: string
          coach_id: string
          name: string
          jersey_number?: string | null
          birth_year?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          coach_id?: string
          name?: string
          jersey_number?: string | null
          birth_year?: number | null
          created_at?: string
        }
      }
      team_players: {
        Row: {
          id: string
          team_id: string
          player_id: string
          positions: any
          hitting_level: number | null
          throwing_level: number | null
          fielding_level: number | null
          focus_notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          team_id: string
          player_id: string
          positions?: any
          hitting_level?: number | null
          throwing_level?: number | null
          fielding_level?: number | null
          focus_notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          team_id?: string
          player_id?: string
          positions?: any
          hitting_level?: number | null
          throwing_level?: number | null
          fielding_level?: number | null
          focus_notes?: string | null
          created_at?: string
        }
      }
      team_notes: {
        Row: {
          id: string
          team_id: string
          title: string | null
          note: string
          pinned: boolean
          created_at: string
        }
        Insert: {
          id?: string
          team_id: string
          title?: string | null
          note: string
          pinned?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          team_id?: string
          title?: string | null
          note?: string
          pinned?: boolean
          created_at?: string
        }
      }
      player_notes: {
        Row: {
          id: string
          team_id: string
          player_id: string
          note: string
          created_at: string
        }
        Insert: {
          id?: string
          team_id: string
          player_id: string
          note: string
          created_at?: string
        }
        Update: {
          id?: string
          team_id?: string
          player_id?: string
          note?: string
          created_at?: string
        }
      }
      player_traits: {
        Row: {
          id: string
          player_id: string
          note: string
          created_at: string
        }
        Insert: {
          id?: string
          player_id: string
          note: string
          created_at?: string
        }
        Update: {
          id?: string
          player_id?: string
          note?: string
          created_at?: string
        }
      }
      practice_plans: {
        Row: {
          id: string
          team_id: string
          title: string
          duration_minutes: number | null
          focus: any
          content: any
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          team_id: string
          title: string
          duration_minutes?: number | null
          focus?: any
          content?: any
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          team_id?: string
          title?: string
          duration_minutes?: number | null
          focus?: any
          content?: any
          created_at?: string
          updated_at?: string
        }
      }
      chat_threads: {
        Row: {
          id: string
          team_id: string
          title: string | null
          created_at: string
        }
        Insert: {
          id?: string
          team_id: string
          title?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          team_id?: string
          title?: string | null
          created_at?: string
        }
      }
      chat_messages: {
        Row: {
          id: string
          thread_id: string
          role: string
          content: string
          memory_suggestions: any
          created_at: string
        }
        Insert: {
          id?: string
          thread_id: string
          role: string
          content: string
          memory_suggestions?: any
          created_at?: string
        }
        Update: {
          id?: string
          thread_id?: string
          role?: string
          content?: string
          memory_suggestions?: any
          created_at?: string
        }
      }
      coach_preferences: {
        Row: {
          id: string
          coach_id: string
          key: string
          value: string
          updated_at: string
        }
        Insert: {
          id?: string
          coach_id: string
          key: string
          value: string
          updated_at?: string
        }
        Update: {
          id?: string
          coach_id?: string
          key?: string
          value?: string
          updated_at?: string
        }
      }
      team_memory_summaries: {
        Row: {
          id: string
          team_id: string
          summary: string
          updated_at: string
        }
        Insert: {
          id?: string
          team_id: string
          summary: string
          updated_at?: string
        }
        Update: {
          id?: string
          team_id?: string
          summary?: string
          updated_at?: string
        }
      }
    }
  }
}

export function createSupabaseClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export function createSupabaseComponentClient() {
  return createClientComponentClient<Database>()
}

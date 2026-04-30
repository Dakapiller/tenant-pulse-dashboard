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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      club_status_log: {
        Row: {
          changed_at: string | null
          changed_by: string | null
          id: string
          new_status: string
          note: string | null
          previous_status: string
          tenant_name: string
        }
        Insert: {
          changed_at?: string | null
          changed_by?: string | null
          id?: string
          new_status: string
          note?: string | null
          previous_status: string
          tenant_name: string
        }
        Update: {
          changed_at?: string | null
          changed_by?: string | null
          id?: string
          new_status?: string
          note?: string | null
          previous_status?: string
          tenant_name?: string
        }
        Relationships: []
      }
      cs_tasks: {
        Row: {
          completed_at: string | null
          created_at: string | null
          cta: string
          flags: string[] | null
          id: string
          note: string | null
          outcome: string | null
          priority: number
          reason: string
          status: string
          tenant_name: string
          week_start: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          cta: string
          flags?: string[] | null
          id?: string
          note?: string | null
          outcome?: string | null
          priority: number
          reason: string
          status?: string
          tenant_name: string
          week_start: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          cta?: string
          flags?: string[] | null
          id?: string
          note?: string | null
          outcome?: string | null
          priority?: number
          reason?: string
          status?: string
          tenant_name?: string
          week_start?: string
        }
        Relationships: []
      }
      cs_tenant_status: {
        Row: {
          churn_competitor: string | null
          club_status: string | null
          health_score: number | null
          id: string
          is_priority: boolean
          note: string | null
          recorded_at: string | null
          relationship_status: string
          tenant_name: string
        }
        Insert: {
          churn_competitor?: string | null
          club_status?: string | null
          health_score?: number | null
          id?: string
          is_priority?: boolean
          note?: string | null
          recorded_at?: string | null
          relationship_status: string
          tenant_name: string
        }
        Update: {
          churn_competitor?: string | null
          club_status?: string | null
          health_score?: number | null
          id?: string
          is_priority?: boolean
          note?: string | null
          recorded_at?: string | null
          relationship_status?: string
          tenant_name?: string
        }
        Relationships: []
      }
      health_score_log: {
        Row: {
          changed_at: string
          changed_by: string | null
          delta: number
          id: string
          new_score: number
          previous_score: number
          reason: string
          source: string
          tenant_name: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          delta: number
          id?: string
          new_score: number
          previous_score: number
          reason: string
          source: string
          tenant_name: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          delta?: number
          id?: string
          new_score?: number
          previous_score?: number
          reason?: string
          source?: string
          tenant_name?: string
        }
        Relationships: []
      }
      tenant_snapshots: {
        Row: {
          b2b_commissions: number | null
          b2c_commissions: number | null
          created_at: string | null
          games_online: number | null
          gmv_all: number | null
          gmv_games: number | null
          id: string
          period: string
          revenue: number | null
          saas: number | null
          tenant_name: string
          transacted_amount: number | null
          transacted_rate: number | null
        }
        Insert: {
          b2b_commissions?: number | null
          b2c_commissions?: number | null
          created_at?: string | null
          games_online?: number | null
          gmv_all?: number | null
          gmv_games?: number | null
          id?: string
          period: string
          revenue?: number | null
          saas?: number | null
          tenant_name: string
          transacted_amount?: number | null
          transacted_rate?: number | null
        }
        Update: {
          b2b_commissions?: number | null
          b2c_commissions?: number | null
          created_at?: string | null
          games_online?: number | null
          gmv_all?: number | null
          gmv_games?: number | null
          id?: string
          period?: string
          revenue?: number | null
          saas?: number | null
          tenant_name?: string
          transacted_amount?: number | null
          transacted_rate?: number | null
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          display_name: string | null
          email: string
          id: string
          role: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          display_name?: string | null
          email: string
          id: string
          role?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          role?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role:
        | {
            Args: {
              _role: Database["public"]["Enums"]["app_role"]
              _user_id: string
            }
            Returns: boolean
          }
        | { Args: { _role: string; _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "superuser" | "cs" | "pending" | "denied"
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
      app_role: ["superuser", "cs", "pending", "denied"],
    },
  },
} as const

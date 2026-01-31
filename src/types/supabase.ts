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
      activity_documents: {
        Row: {
          activity_id: string | null
          created_at: string | null
          document_id: string | null
          id: string
          relevance_type: string | null
        }
        Insert: {
          activity_id?: string | null
          created_at?: string | null
          document_id?: string | null
          id?: string
          relevance_type?: string | null
        }
        Update: {
          activity_id?: string | null
          created_at?: string | null
          document_id?: string | null
          id?: string
          relevance_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_documents_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "schedule_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_predecessors: {
        Row: {
          activity_id: string | null
          created_at: string | null
          id: string
          lag_days: number | null
          predecessor_id: string | null
          relationship_type: string | null
        }
        Insert: {
          activity_id?: string | null
          created_at?: string | null
          id?: string
          lag_days?: number | null
          predecessor_id?: string | null
          relationship_type?: string | null
        }
        Update: {
          activity_id?: string | null
          created_at?: string | null
          id?: string
          lag_days?: number | null
          predecessor_id?: string | null
          relationship_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_predecessors_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "schedule_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_predecessors_predecessor_id_fkey"
            columns: ["predecessor_id"]
            isOneToOne: false
            referencedRelation: "schedule_activities"
            referencedColumns: ["id"]
          },
        ]
      }
      document_chunks: {
        Row: {
          chunk_index: number
          chunk_type: string | null
          content: string
          created_at: string | null
          document_id: string | null
          extracted_quantities: Json | null
          id: string
          is_critical_sheet: boolean | null
          metadata: Json | null
          page_number: number | null
          project_id: string | null
          sheet_type: string | null
          stations: Json | null
          vision_data: Json | null
          vision_model_version: string | null
          vision_processed_at: string | null
        }
        Insert: {
          chunk_index: number
          chunk_type?: string | null
          content: string
          created_at?: string | null
          document_id?: string | null
          extracted_quantities?: Json | null
          id?: string
          is_critical_sheet?: boolean | null
          metadata?: Json | null
          page_number?: number | null
          project_id?: string | null
          sheet_type?: string | null
          stations?: Json | null
          vision_data?: Json | null
          vision_model_version?: string | null
          vision_processed_at?: string | null
        }
        Update: {
          chunk_index?: number
          chunk_type?: string | null
          content?: string
          created_at?: string | null
          document_id?: string | null
          extracted_quantities?: Json | null
          id?: string
          is_critical_sheet?: boolean | null
          metadata?: Json | null
          page_number?: number | null
          project_id?: string | null
          sheet_type?: string | null
          stations?: Json | null
          vision_data?: Json | null
          vision_model_version?: string | null
          vision_processed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_chunks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_quantity_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "document_chunks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      document_embeddings: {
        Row: {
          chunk_id: string | null
          created_at: string | null
          embedding: string | null
          id: string
          model_version: string | null
        }
        Insert: {
          chunk_id?: string | null
          created_at?: string | null
          embedding?: string | null
          id?: string
          model_version?: string | null
        }
        Update: {
          chunk_id?: string | null
          created_at?: string | null
          embedding?: string | null
          id?: string
          model_version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_embeddings_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: false
            referencedRelation: "document_chunks"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          created_at: string | null
          description: string | null
          discipline: string | null
          document_type: string | null
          file_path: string
          file_size_bytes: number | null
          file_type: string
          filename: string
          id: string
          metadata: Json | null
          page_count: number | null
          processing_status: string | null
          project_id: string | null
          revision: string | null
          sheet_number: string | null
          updated_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          discipline?: string | null
          document_type?: string | null
          file_path: string
          file_size_bytes?: number | null
          file_type: string
          filename: string
          id?: string
          metadata?: Json | null
          page_count?: number | null
          processing_status?: string | null
          project_id?: string | null
          revision?: string | null
          sheet_number?: string | null
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          discipline?: string | null
          document_type?: string | null
          file_path?: string
          file_size_bytes?: number | null
          file_type?: string
          filename?: string
          id?: string
          metadata?: Json | null
          page_count?: number | null
          processing_status?: string | null
          project_id?: string | null
          revision?: string | null
          sheet_number?: string | null
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_quantity_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string | null
          id: string
          name: string
          subscription_tier: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          subscription_tier?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          subscription_tier?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      project_members: {
        Row: {
          created_at: string | null
          id: string
          project_id: string | null
          role: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          project_id?: string | null
          role?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          project_id?: string | null
          role?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_quantity_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      project_quantities: {
        Row: {
          chunk_id: string | null
          confidence: number | null
          created_at: string | null
          description: string | null
          document_id: string
          id: string
          item_name: string
          item_number: string | null
          item_type: string | null
          location_description: string | null
          metadata: Json | null
          project_id: string
          quantity: number | null
          sheet_number: string | null
          source_type: string | null
          station_from: string | null
          station_to: string | null
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          chunk_id?: string | null
          confidence?: number | null
          created_at?: string | null
          description?: string | null
          document_id: string
          id?: string
          item_name: string
          item_number?: string | null
          item_type?: string | null
          location_description?: string | null
          metadata?: Json | null
          project_id: string
          quantity?: number | null
          sheet_number?: string | null
          source_type?: string | null
          station_from?: string | null
          station_to?: string | null
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          chunk_id?: string | null
          confidence?: number | null
          created_at?: string | null
          description?: string | null
          document_id?: string
          id?: string
          item_name?: string
          item_number?: string | null
          item_type?: string | null
          location_description?: string | null
          metadata?: Json | null
          project_id?: string
          quantity?: number | null
          sheet_number?: string | null
          source_type?: string | null
          station_from?: string | null
          station_to?: string | null
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_quantities_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: false
            referencedRelation: "document_chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_quantities_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_quantities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_quantity_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_quantities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          address: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          end_date: string | null
          id: string
          metadata: Json | null
          name: string
          organization_id: string | null
          project_number: string | null
          start_date: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          metadata?: Json | null
          name: string
          organization_id?: string | null
          project_number?: string | null
          start_date?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          metadata?: Json | null
          name?: string
          organization_id?: string | null
          project_number?: string | null
          start_date?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      query_analytics: {
        Row: {
          cost_usd: number | null
          created_at: string | null
          direct_lookup_results: number | null
          id: string
          latency_ms: number | null
          metadata: Json | null
          project_id: string
          query_classification: Json | null
          query_text: string
          query_type: string | null
          response_method: string | null
          response_text: string | null
          sources: Json | null
          success: boolean | null
          tokens_used: number | null
          user_feedback_rating: number | null
          user_feedback_text: string | null
          user_id: string
          vector_search_results: number | null
          vision_calls_made: number | null
        }
        Insert: {
          cost_usd?: number | null
          created_at?: string | null
          direct_lookup_results?: number | null
          id?: string
          latency_ms?: number | null
          metadata?: Json | null
          project_id: string
          query_classification?: Json | null
          query_text: string
          query_type?: string | null
          response_method?: string | null
          response_text?: string | null
          sources?: Json | null
          success?: boolean | null
          tokens_used?: number | null
          user_feedback_rating?: number | null
          user_feedback_text?: string | null
          user_id: string
          vector_search_results?: number | null
          vision_calls_made?: number | null
        }
        Update: {
          cost_usd?: number | null
          created_at?: string | null
          direct_lookup_results?: number | null
          id?: string
          latency_ms?: number | null
          metadata?: Json | null
          project_id?: string
          query_classification?: Json | null
          query_text?: string
          query_type?: string | null
          response_method?: string | null
          response_text?: string | null
          sources?: Json | null
          success?: boolean | null
          tokens_used?: number | null
          user_feedback_rating?: number | null
          user_feedback_text?: string | null
          user_id?: string
          vector_search_results?: number | null
          vision_calls_made?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "query_analytics_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_quantity_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "query_analytics_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "query_analytics_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      query_history: {
        Row: {
          created_at: string | null
          feedback_rating: number | null
          id: string
          latency_ms: number | null
          project_id: string | null
          query_text: string
          query_type: string | null
          response_text: string | null
          sources: Json | null
          tokens_used: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          feedback_rating?: number | null
          id?: string
          latency_ms?: number | null
          project_id?: string | null
          query_text: string
          query_type?: string | null
          response_text?: string | null
          sources?: Json | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          feedback_rating?: number | null
          id?: string
          latency_ms?: number | null
          project_id?: string | null
          query_text?: string
          query_type?: string | null
          response_text?: string | null
          sources?: Json | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "query_history_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_quantity_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "query_history_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "query_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      rfis: {
        Row: {
          assigned_to: string | null
          created_at: string | null
          due_date: string | null
          id: string
          metadata: Json | null
          priority: string | null
          project_id: string | null
          question: string
          related_activities: string[] | null
          related_documents: string[] | null
          response: string | null
          rfi_number: string
          status: string | null
          subject: string
          submitted_by: string | null
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string | null
          due_date?: string | null
          id?: string
          metadata?: Json | null
          priority?: string | null
          project_id?: string | null
          question: string
          related_activities?: string[] | null
          related_documents?: string[] | null
          response?: string | null
          rfi_number: string
          status?: string | null
          subject: string
          submitted_by?: string | null
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          created_at?: string | null
          due_date?: string | null
          id?: string
          metadata?: Json | null
          priority?: string | null
          project_id?: string | null
          question?: string
          related_activities?: string[] | null
          related_documents?: string[] | null
          response?: string | null
          rfi_number?: string
          status?: string | null
          subject?: string
          submitted_by?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rfis_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_quantity_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "rfis_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfis_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_activities: {
        Row: {
          activity_id: string
          activity_name: string
          actual_finish: string | null
          actual_start: string | null
          calendar: string | null
          cost_code: string | null
          created_at: string | null
          description: string | null
          duration_days: number | null
          early_finish: string | null
          early_start: string | null
          id: string
          is_critical: boolean | null
          late_finish: string | null
          late_start: string | null
          metadata: Json | null
          percent_complete: number | null
          project_id: string | null
          responsible_party: string | null
          total_float_days: number | null
          updated_at: string | null
          version_id: string | null
          wbs_code: string | null
        }
        Insert: {
          activity_id: string
          activity_name: string
          actual_finish?: string | null
          actual_start?: string | null
          calendar?: string | null
          cost_code?: string | null
          created_at?: string | null
          description?: string | null
          duration_days?: number | null
          early_finish?: string | null
          early_start?: string | null
          id?: string
          is_critical?: boolean | null
          late_finish?: string | null
          late_start?: string | null
          metadata?: Json | null
          percent_complete?: number | null
          project_id?: string | null
          responsible_party?: string | null
          total_float_days?: number | null
          updated_at?: string | null
          version_id?: string | null
          wbs_code?: string | null
        }
        Update: {
          activity_id?: string
          activity_name?: string
          actual_finish?: string | null
          actual_start?: string | null
          calendar?: string | null
          cost_code?: string | null
          created_at?: string | null
          description?: string | null
          duration_days?: number | null
          early_finish?: string | null
          early_start?: string | null
          id?: string
          is_critical?: boolean | null
          late_finish?: string | null
          late_start?: string | null
          metadata?: Json | null
          percent_complete?: number | null
          project_id?: string | null
          responsible_party?: string | null
          total_float_days?: number | null
          updated_at?: string | null
          version_id?: string | null
          wbs_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_activities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_quantity_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "schedule_activities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_activities_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "schedule_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_versions: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_baseline: boolean | null
          project_id: string | null
          version_date: string
          version_number: number
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_baseline?: boolean | null
          project_id?: string | null
          version_date: string
          version_number: number
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_baseline?: boolean | null
          project_id?: string | null
          version_date?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "schedule_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_quantity_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "schedule_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string | null
          email: string
          full_name: string | null
          id: string
          organization_id: string | null
          role: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          full_name?: string | null
          id: string
          organization_id?: string | null
          role?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          full_name?: string | null
          id?: string
          organization_id?: string | null
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      project_quantity_summary: {
        Row: {
          avg_confidence: number | null
          document_count: number | null
          item_count: number | null
          item_type: string | null
          items: Json | null
          project_id: string | null
          project_name: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      create_project_secure: {
        Args: {
          p_address?: string
          p_description?: string
          p_end_date?: string
          p_name: string
          p_organization_id?: string
          p_start_date?: string
        }
        Returns: Json
      }
      get_user_organization_id: { Args: never; Returns: string }
      get_user_project_ids: {
        Args: never
        Returns: {
          project_id: string
        }[]
      }
      normalize_station: { Args: { station: string }; Returns: string }
      project_has_no_members: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      search_documents: {
        Args: {
          filter_document_ids?: string[]
          filter_project_id?: string
          match_count?: number
          query_embedding: string
          similarity_threshold?: number
        }
        Returns: {
          chunk_id: string
          chunk_index: number
          content: string
          document_filename: string
          document_id: string
          page_number: number
          project_id: string
          sheet_number: string
          similarity: number
        }[]
      }
      search_quantities: {
        Args: { p_limit?: number; p_project_id: string; p_search_term: string }
        Returns: {
          confidence: number
          id: string
          item_name: string
          item_type: string
          quantity: number
          sheet_number: string
          similarity: number
          unit: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      station_distance: {
        Args: { sta1: string; sta2: string }
        Returns: number
      }
      test_auth_context: { Args: never; Returns: Json }
      user_can_edit_project: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      user_can_manage_project: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      user_is_project_owner: {
        Args: { p_project_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const

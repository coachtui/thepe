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
            referencedRelation: "document_processing_status"
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
      component_callouts: {
        Row: {
          associated_system: string | null
          component_family: string | null
          confidence: number
          created_at: string
          document_id: string
          document_page_id: string | null
          id: string
          normalized_component: string | null
          page_number: number
          project_id: string
          raw_callout_text: string
          sheet_number: string | null
          source_view: string | null
          station: string | null
        }
        Insert: {
          associated_system?: string | null
          component_family?: string | null
          confidence?: number
          created_at?: string
          document_id: string
          document_page_id?: string | null
          id?: string
          normalized_component?: string | null
          page_number: number
          project_id: string
          raw_callout_text: string
          sheet_number?: string | null
          source_view?: string | null
          station?: string | null
        }
        Update: {
          associated_system?: string | null
          component_family?: string | null
          confidence?: number
          created_at?: string
          document_id?: string
          document_page_id?: string | null
          id?: string
          normalized_component?: string | null
          page_number?: number
          project_id?: string
          raw_callout_text?: string
          sheet_number?: string | null
          source_view?: string | null
          station?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "component_callouts_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "document_processing_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "component_callouts_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "component_callouts_document_page_id_fkey"
            columns: ["document_page_id"]
            isOneToOne: false
            referencedRelation: "document_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "component_callouts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_quantity_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "component_callouts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "component_callouts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
          },
        ]
      }
      document_chunks: {
        Row: {
          chunk_index: number
          chunk_type: string | null
          component_list: string[] | null
          contains_components: boolean | null
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
          station: string | null
          stations: Json | null
          system_name: string | null
          vision_data: Json | null
          vision_model_version: string | null
          vision_processed_at: string | null
        }
        Insert: {
          chunk_index: number
          chunk_type?: string | null
          component_list?: string[] | null
          contains_components?: boolean | null
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
          station?: string | null
          stations?: Json | null
          system_name?: string | null
          vision_data?: Json | null
          vision_model_version?: string | null
          vision_processed_at?: string | null
        }
        Update: {
          chunk_index?: number
          chunk_type?: string | null
          component_list?: string[] | null
          contains_components?: boolean | null
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
          station?: string | null
          stations?: Json | null
          system_name?: string | null
          vision_data?: Json | null
          vision_model_version?: string | null
          vision_processed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "document_processing_status"
            referencedColumns: ["id"]
          },
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
          {
            foreignKeyName: "document_chunks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
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
      document_pages: {
        Row: {
          created_at: string | null
          disciplines: string[] | null
          document_id: string
          embedding: string | null
          has_plan_view: boolean | null
          has_profile_view: boolean | null
          has_quantities: boolean | null
          has_stations: boolean | null
          id: string
          indexed_at: string | null
          page_image_url: string | null
          page_number: number
          project_id: string
          sheet_number: string | null
          sheet_title: string | null
          sheet_type: string | null
          station_end: string | null
          station_end_numeric: number | null
          station_start: string | null
          station_start_numeric: number | null
          text_content: string | null
          updated_at: string | null
          utilities: string[] | null
          utility_designations: string[] | null
          vision_data: Json | null
        }
        Insert: {
          created_at?: string | null
          disciplines?: string[] | null
          document_id: string
          embedding?: string | null
          has_plan_view?: boolean | null
          has_profile_view?: boolean | null
          has_quantities?: boolean | null
          has_stations?: boolean | null
          id?: string
          indexed_at?: string | null
          page_image_url?: string | null
          page_number: number
          project_id: string
          sheet_number?: string | null
          sheet_title?: string | null
          sheet_type?: string | null
          station_end?: string | null
          station_end_numeric?: number | null
          station_start?: string | null
          station_start_numeric?: number | null
          text_content?: string | null
          updated_at?: string | null
          utilities?: string[] | null
          utility_designations?: string[] | null
          vision_data?: Json | null
        }
        Update: {
          created_at?: string | null
          disciplines?: string[] | null
          document_id?: string
          embedding?: string | null
          has_plan_view?: boolean | null
          has_profile_view?: boolean | null
          has_quantities?: boolean | null
          has_stations?: boolean | null
          id?: string
          indexed_at?: string | null
          page_image_url?: string | null
          page_number?: number
          project_id?: string
          sheet_number?: string | null
          sheet_title?: string | null
          sheet_type?: string | null
          station_end?: string | null
          station_end_numeric?: number | null
          station_start?: string | null
          station_start_numeric?: number | null
          text_content?: string | null
          updated_at?: string | null
          utilities?: string[] | null
          utility_designations?: string[] | null
          vision_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "document_pages_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "document_processing_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_pages_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_pages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_quantity_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "document_pages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_pages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
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
          vision_cost_usd: number | null
          vision_error: string | null
          vision_processed_at: string | null
          vision_quantities_extracted: number | null
          vision_sheets_processed: number | null
          vision_status: string | null
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
          vision_cost_usd?: number | null
          vision_error?: string | null
          vision_processed_at?: string | null
          vision_quantities_extracted?: number | null
          vision_sheets_processed?: number | null
          vision_status?: string | null
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
          vision_cost_usd?: number | null
          vision_error?: string | null
          vision_processed_at?: string | null
          vision_quantities_extracted?: number | null
          vision_sheets_processed?: number | null
          vision_status?: string | null
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
            foreignKeyName: "documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
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
      entity_citations: {
        Row: {
          chunk_id: string | null
          confidence: number | null
          context: string | null
          created_at: string | null
          detail_ref: string | null
          document_id: string | null
          entity_id: string | null
          excerpt: string | null
          extraction_source: string | null
          finding_id: string | null
          id: string
          page_number: number | null
          project_id: string
          relationship_id: string | null
          sheet_number: string | null
        }
        Insert: {
          chunk_id?: string | null
          confidence?: number | null
          context?: string | null
          created_at?: string | null
          detail_ref?: string | null
          document_id?: string | null
          entity_id?: string | null
          excerpt?: string | null
          extraction_source?: string | null
          finding_id?: string | null
          id?: string
          page_number?: number | null
          project_id: string
          relationship_id?: string | null
          sheet_number?: string | null
        }
        Update: {
          chunk_id?: string | null
          confidence?: number | null
          context?: string | null
          created_at?: string | null
          detail_ref?: string | null
          document_id?: string | null
          entity_id?: string | null
          excerpt?: string | null
          extraction_source?: string | null
          finding_id?: string | null
          id?: string
          page_number?: number | null
          project_id?: string
          relationship_id?: string | null
          sheet_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entity_citations_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: false
            referencedRelation: "document_chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_citations_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "document_processing_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_citations_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_citations_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "project_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_citations_finding_id_fkey"
            columns: ["finding_id"]
            isOneToOne: false
            referencedRelation: "entity_findings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_citations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_quantity_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "entity_citations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_citations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "entity_citations_relationship_id_fkey"
            columns: ["relationship_id"]
            isOneToOne: false
            referencedRelation: "entity_relationships"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_findings: {
        Row: {
          citation_id: string | null
          confidence: number | null
          created_at: string | null
          entity_id: string
          finding_type: string
          id: string
          metadata: Json | null
          numeric_value: number | null
          project_id: string
          statement: string
          support_level: string | null
          text_value: string | null
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          citation_id?: string | null
          confidence?: number | null
          created_at?: string | null
          entity_id: string
          finding_type: string
          id?: string
          metadata?: Json | null
          numeric_value?: number | null
          project_id: string
          statement: string
          support_level?: string | null
          text_value?: string | null
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          citation_id?: string | null
          confidence?: number | null
          created_at?: string | null
          entity_id?: string
          finding_type?: string
          id?: string
          metadata?: Json | null
          numeric_value?: number | null
          project_id?: string
          statement?: string
          support_level?: string | null
          text_value?: string | null
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entity_findings_citation_id_fkey"
            columns: ["citation_id"]
            isOneToOne: false
            referencedRelation: "entity_citations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_findings_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "project_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_findings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_quantity_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "entity_findings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_findings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "fk_finding_entity_project"
            columns: ["entity_id", "project_id"]
            isOneToOne: false
            referencedRelation: "project_entities"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      entity_locations: {
        Row: {
          area: string | null
          created_at: string | null
          description: string | null
          detail_ref: string | null
          entity_id: string
          grid_ref: string | null
          id: string
          is_primary: boolean | null
          level: string | null
          location_type: string
          page_number: number | null
          project_id: string
          room_number: string | null
          sheet_number: string | null
          station_numeric: number | null
          station_to: string | null
          station_to_numeric: number | null
          station_value: string | null
          zone: string | null
        }
        Insert: {
          area?: string | null
          created_at?: string | null
          description?: string | null
          detail_ref?: string | null
          entity_id: string
          grid_ref?: string | null
          id?: string
          is_primary?: boolean | null
          level?: string | null
          location_type: string
          page_number?: number | null
          project_id: string
          room_number?: string | null
          sheet_number?: string | null
          station_numeric?: number | null
          station_to?: string | null
          station_to_numeric?: number | null
          station_value?: string | null
          zone?: string | null
        }
        Update: {
          area?: string | null
          created_at?: string | null
          description?: string | null
          detail_ref?: string | null
          entity_id?: string
          grid_ref?: string | null
          id?: string
          is_primary?: boolean | null
          level?: string | null
          location_type?: string
          page_number?: number | null
          project_id?: string
          room_number?: string | null
          sheet_number?: string | null
          station_numeric?: number | null
          station_to?: string | null
          station_to_numeric?: number | null
          station_value?: string | null
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entity_locations_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "project_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_locations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_quantity_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "entity_locations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_locations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "fk_location_entity_project"
            columns: ["entity_id", "project_id"]
            isOneToOne: false
            referencedRelation: "project_entities"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      entity_relationships: {
        Row: {
          citation_id: string | null
          confidence: number | null
          created_at: string | null
          elevation: number | null
          extraction_source: string | null
          from_entity_id: string
          id: string
          metadata: Json | null
          notes: string | null
          project_id: string
          relationship_type: string
          station: string | null
          station_numeric: number | null
          to_entity_id: string
        }
        Insert: {
          citation_id?: string | null
          confidence?: number | null
          created_at?: string | null
          elevation?: number | null
          extraction_source?: string | null
          from_entity_id: string
          id?: string
          metadata?: Json | null
          notes?: string | null
          project_id: string
          relationship_type: string
          station?: string | null
          station_numeric?: number | null
          to_entity_id: string
        }
        Update: {
          citation_id?: string | null
          confidence?: number | null
          created_at?: string | null
          elevation?: number | null
          extraction_source?: string | null
          from_entity_id?: string
          id?: string
          metadata?: Json | null
          notes?: string | null
          project_id?: string
          relationship_type?: string
          station?: string | null
          station_numeric?: number | null
          to_entity_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_relationships_citation_id_fkey"
            columns: ["citation_id"]
            isOneToOne: false
            referencedRelation: "entity_citations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_relationships_from_entity_id_fkey"
            columns: ["from_entity_id"]
            isOneToOne: false
            referencedRelation: "project_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_relationships_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_quantity_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "entity_relationships_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_relationships_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "entity_relationships_to_entity_id_fkey"
            columns: ["to_entity_id"]
            isOneToOne: false
            referencedRelation: "project_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_rel_from_entity_project"
            columns: ["from_entity_id", "project_id"]
            isOneToOne: false
            referencedRelation: "project_entities"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "fk_rel_to_entity_project"
            columns: ["to_entity_id", "project_id"]
            isOneToOne: false
            referencedRelation: "project_entities"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      memory_confirmations: {
        Row: {
          created_at: string
          id: string
          memory_item_id: string
          note: string | null
          user_id: string
          user_role: string | null
          vote: string
        }
        Insert: {
          created_at?: string
          id?: string
          memory_item_id: string
          note?: string | null
          user_id: string
          user_role?: string | null
          vote: string
        }
        Update: {
          created_at?: string
          id?: string
          memory_item_id?: string
          note?: string | null
          user_id?: string
          user_role?: string | null
          vote?: string
        }
        Relationships: [
          {
            foreignKeyName: "memory_confirmations_memory_item_id_fkey"
            columns: ["memory_item_id"]
            isOneToOne: false
            referencedRelation: "project_memory_items"
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
      project_corrections: {
        Row: {
          ai_confidence: number | null
          ai_detected_value: string | null
          ai_response_excerpt: string | null
          confirmed_by_count: number
          created_at: string
          discipline: string | null
          evidence_reference: string | null
          expected_item: string | null
          expected_value: string
          how_it_appeared: string | null
          id: string
          memory_item_id: string | null
          missed_item_type: string | null
          notes: string | null
          project_id: string
          query_answer_mode: string | null
          query_text: string
          rejected_by_count: number
          sheet_number: string | null
          source_type: string
          submitted_at: string
          submitted_by_name: string | null
          submitted_by_role: string
          submitted_by_user_id: string
          system_queried: string | null
          validation_status: string
        }
        Insert: {
          ai_confidence?: number | null
          ai_detected_value?: string | null
          ai_response_excerpt?: string | null
          confirmed_by_count?: number
          created_at?: string
          discipline?: string | null
          evidence_reference?: string | null
          expected_item?: string | null
          expected_value: string
          how_it_appeared?: string | null
          id?: string
          memory_item_id?: string | null
          missed_item_type?: string | null
          notes?: string | null
          project_id: string
          query_answer_mode?: string | null
          query_text: string
          rejected_by_count?: number
          sheet_number?: string | null
          source_type?: string
          submitted_at?: string
          submitted_by_name?: string | null
          submitted_by_role: string
          submitted_by_user_id: string
          system_queried?: string | null
          validation_status?: string
        }
        Update: {
          ai_confidence?: number | null
          ai_detected_value?: string | null
          ai_response_excerpt?: string | null
          confirmed_by_count?: number
          created_at?: string
          discipline?: string | null
          evidence_reference?: string | null
          expected_item?: string | null
          expected_value?: string
          how_it_appeared?: string | null
          id?: string
          memory_item_id?: string | null
          missed_item_type?: string | null
          notes?: string | null
          project_id?: string
          query_answer_mode?: string | null
          query_text?: string
          rejected_by_count?: number
          sheet_number?: string | null
          source_type?: string
          submitted_at?: string
          submitted_by_name?: string | null
          submitted_by_role?: string
          submitted_by_user_id?: string
          system_queried?: string | null
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_corrections_memory_item_id_fkey"
            columns: ["memory_item_id"]
            isOneToOne: false
            referencedRelation: "project_memory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_corrections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_quantity_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_corrections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_corrections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
          },
        ]
      }
      project_entities: {
        Row: {
          canonical_name: string
          confidence: number | null
          created_at: string | null
          discipline: string
          display_name: string | null
          entity_type: string
          extraction_source: string | null
          id: string
          label: string | null
          legacy_crossing_id: string | null
          legacy_quantity_id: string | null
          legacy_termination_id: string | null
          metadata: Json | null
          project_id: string
          source_chunk_id: string | null
          source_document_id: string | null
          status: string | null
          subtype: string | null
          updated_at: string | null
        }
        Insert: {
          canonical_name: string
          confidence?: number | null
          created_at?: string | null
          discipline: string
          display_name?: string | null
          entity_type: string
          extraction_source?: string | null
          id?: string
          label?: string | null
          legacy_crossing_id?: string | null
          legacy_quantity_id?: string | null
          legacy_termination_id?: string | null
          metadata?: Json | null
          project_id: string
          source_chunk_id?: string | null
          source_document_id?: string | null
          status?: string | null
          subtype?: string | null
          updated_at?: string | null
        }
        Update: {
          canonical_name?: string
          confidence?: number | null
          created_at?: string | null
          discipline?: string
          display_name?: string | null
          entity_type?: string
          extraction_source?: string | null
          id?: string
          label?: string | null
          legacy_crossing_id?: string | null
          legacy_quantity_id?: string | null
          legacy_termination_id?: string | null
          metadata?: Json | null
          project_id?: string
          source_chunk_id?: string | null
          source_document_id?: string | null
          status?: string | null
          subtype?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_entities_legacy_crossing_id_fkey"
            columns: ["legacy_crossing_id"]
            isOneToOne: false
            referencedRelation: "utility_crossings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_entities_legacy_quantity_id_fkey"
            columns: ["legacy_quantity_id"]
            isOneToOne: false
            referencedRelation: "project_quantities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_entities_legacy_termination_id_fkey"
            columns: ["legacy_termination_id"]
            isOneToOne: false
            referencedRelation: "utility_termination_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_entities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_quantity_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_entities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_entities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_entities_source_chunk_id_fkey"
            columns: ["source_chunk_id"]
            isOneToOne: false
            referencedRelation: "document_chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_entities_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "document_processing_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_entities_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
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
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
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
      project_memory_items: {
        Row: {
          confidence_modifier: number | null
          confirmed_by_count: number
          created_at: string
          discipline: string | null
          evidence_reference: string | null
          id: string
          item_type: string
          normalized_value: string
          notes: string | null
          original_text: string | null
          pattern_regex: string | null
          project_id: string
          rejected_by_count: number
          sheet_numbers: string[] | null
          source_type: string
          submitted_at: string
          submitted_by_name: string | null
          submitted_by_role: string
          submitted_by_user_id: string
          superseded_by_id: string | null
          system_context: string | null
          updated_at: string
          validation_status: string
        }
        Insert: {
          confidence_modifier?: number | null
          confirmed_by_count?: number
          created_at?: string
          discipline?: string | null
          evidence_reference?: string | null
          id?: string
          item_type: string
          normalized_value: string
          notes?: string | null
          original_text?: string | null
          pattern_regex?: string | null
          project_id: string
          rejected_by_count?: number
          sheet_numbers?: string[] | null
          source_type: string
          submitted_at?: string
          submitted_by_name?: string | null
          submitted_by_role: string
          submitted_by_user_id: string
          superseded_by_id?: string | null
          system_context?: string | null
          updated_at?: string
          validation_status?: string
        }
        Update: {
          confidence_modifier?: number | null
          confirmed_by_count?: number
          created_at?: string
          discipline?: string | null
          evidence_reference?: string | null
          id?: string
          item_type?: string
          normalized_value?: string
          notes?: string | null
          original_text?: string | null
          pattern_regex?: string | null
          project_id?: string
          rejected_by_count?: number
          sheet_numbers?: string[] | null
          source_type?: string
          submitted_at?: string
          submitted_by_name?: string | null
          submitted_by_role?: string
          submitted_by_user_id?: string
          superseded_by_id?: string | null
          system_context?: string | null
          updated_at?: string
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_memory_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_quantity_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_memory_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_memory_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_memory_items_superseded_by_id_fkey"
            columns: ["superseded_by_id"]
            isOneToOne: false
            referencedRelation: "project_memory_items"
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
            referencedRelation: "document_processing_status"
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
          {
            foreignKeyName: "project_quantities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
          },
        ]
      }
      project_source_quality: {
        Row: {
          confidence_cap: number | null
          confidence_modifier: number | null
          discipline: string | null
          id: string
          project_id: string
          reason: string | null
          source_name: string
          submitted_at: string
          submitted_by_role: string | null
          submitted_by_user_id: string | null
          system_context: string | null
        }
        Insert: {
          confidence_cap?: number | null
          confidence_modifier?: number | null
          discipline?: string | null
          id?: string
          project_id: string
          reason?: string | null
          source_name: string
          submitted_at?: string
          submitted_by_role?: string | null
          submitted_by_user_id?: string | null
          system_context?: string | null
        }
        Update: {
          confidence_cap?: number | null
          confidence_modifier?: number | null
          discipline?: string | null
          id?: string
          project_id?: string
          reason?: string | null
          source_name?: string
          submitted_at?: string
          submitted_by_role?: string | null
          submitted_by_user_id?: string | null
          system_context?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_source_quality_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_quantity_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_source_quality_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_source_quality_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
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
            foreignKeyName: "query_analytics_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
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
            foreignKeyName: "query_history_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
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
      recheck_sessions: {
        Row: {
          accepted_into_memory: boolean | null
          cost_usd: number | null
          created_at: string
          delta_detected: boolean | null
          delta_summary: string | null
          discipline: string | null
          id: string
          live_value: string | null
          memory_item_id: string | null
          project_id: string
          query_text: string
          sheets_inspected: string[] | null
          stored_value: string | null
          system_context: string | null
          triggered_by_user_id: string | null
        }
        Insert: {
          accepted_into_memory?: boolean | null
          cost_usd?: number | null
          created_at?: string
          delta_detected?: boolean | null
          delta_summary?: string | null
          discipline?: string | null
          id?: string
          live_value?: string | null
          memory_item_id?: string | null
          project_id: string
          query_text: string
          sheets_inspected?: string[] | null
          stored_value?: string | null
          system_context?: string | null
          triggered_by_user_id?: string | null
        }
        Update: {
          accepted_into_memory?: boolean | null
          cost_usd?: number | null
          created_at?: string
          delta_detected?: boolean | null
          delta_summary?: string | null
          discipline?: string | null
          id?: string
          live_value?: string | null
          memory_item_id?: string | null
          project_id?: string
          query_text?: string
          sheets_inspected?: string[] | null
          stored_value?: string | null
          system_context?: string | null
          triggered_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recheck_sessions_memory_item_id_fkey"
            columns: ["memory_item_id"]
            isOneToOne: false
            referencedRelation: "project_memory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recheck_sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_quantity_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "recheck_sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recheck_sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
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
            foreignKeyName: "rfis_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
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
            foreignKeyName: "schedule_activities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
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
          {
            foreignKeyName: "schedule_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
          },
        ]
      }
      sheet_entities: {
        Row: {
          confidence: number | null
          created_at: string | null
          document_id: string
          document_page_id: string
          entity_context: string | null
          entity_type: string
          entity_value: string
          id: string
          page_number: number
          project_id: string
          sheet_number: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          document_id: string
          document_page_id: string
          entity_context?: string | null
          entity_type: string
          entity_value: string
          id?: string
          page_number: number
          project_id: string
          sheet_number?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          document_id?: string
          document_page_id?: string
          entity_context?: string | null
          entity_type?: string
          entity_value?: string
          id?: string
          page_number?: number
          project_id?: string
          sheet_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sheet_entities_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "document_processing_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_entities_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_entities_document_page_id_fkey"
            columns: ["document_page_id"]
            isOneToOne: false
            referencedRelation: "document_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_entities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_quantity_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "sheet_entities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_entities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
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
      utility_crossings: {
        Row: {
          chunk_id: string | null
          confidence: number | null
          created_at: string | null
          crossing_utility: string
          document_id: string
          elevation: number | null
          extracted_at: string | null
          id: string
          is_existing: boolean | null
          is_proposed: boolean | null
          notes: string | null
          project_id: string
          sheet_number: string | null
          size: string | null
          source_type: string | null
          station: string | null
          station_numeric: number | null
          updated_at: string | null
          utility_full_name: string
          vision_data: Json | null
        }
        Insert: {
          chunk_id?: string | null
          confidence?: number | null
          created_at?: string | null
          crossing_utility: string
          document_id: string
          elevation?: number | null
          extracted_at?: string | null
          id?: string
          is_existing?: boolean | null
          is_proposed?: boolean | null
          notes?: string | null
          project_id: string
          sheet_number?: string | null
          size?: string | null
          source_type?: string | null
          station?: string | null
          station_numeric?: number | null
          updated_at?: string | null
          utility_full_name: string
          vision_data?: Json | null
        }
        Update: {
          chunk_id?: string | null
          confidence?: number | null
          created_at?: string | null
          crossing_utility?: string
          document_id?: string
          elevation?: number | null
          extracted_at?: string | null
          id?: string
          is_existing?: boolean | null
          is_proposed?: boolean | null
          notes?: string | null
          project_id?: string
          sheet_number?: string | null
          size?: string | null
          source_type?: string | null
          station?: string | null
          station_numeric?: number | null
          updated_at?: string | null
          utility_full_name?: string
          vision_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "utility_crossings_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: false
            referencedRelation: "document_chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "utility_crossings_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "document_processing_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "utility_crossings_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "utility_crossings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_quantity_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "utility_crossings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "utility_crossings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
          },
        ]
      }
      utility_length_canonical: {
        Row: {
          begin_sheet: string | null
          begin_station: string | null
          begin_station_numeric: number | null
          confidence: number | null
          created_at: string | null
          end_sheet: string | null
          end_station: string | null
          end_station_numeric: number | null
          id: string
          length_lf: number | null
          method: string | null
          project_id: string
          updated_at: string | null
          utility_name: string
          utility_type: string | null
        }
        Insert: {
          begin_sheet?: string | null
          begin_station?: string | null
          begin_station_numeric?: number | null
          confidence?: number | null
          created_at?: string | null
          end_sheet?: string | null
          end_station?: string | null
          end_station_numeric?: number | null
          id?: string
          length_lf?: number | null
          method?: string | null
          project_id: string
          updated_at?: string | null
          utility_name: string
          utility_type?: string | null
        }
        Update: {
          begin_sheet?: string | null
          begin_station?: string | null
          begin_station_numeric?: number | null
          confidence?: number | null
          created_at?: string | null
          end_sheet?: string | null
          end_station?: string | null
          end_station_numeric?: number | null
          id?: string
          length_lf?: number | null
          method?: string | null
          project_id?: string
          updated_at?: string | null
          utility_name?: string
          utility_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "utility_length_canonical_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_quantity_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "utility_length_canonical_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "utility_length_canonical_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
          },
        ]
      }
      utility_termination_points: {
        Row: {
          chunk_id: string | null
          confidence: number | null
          created_at: string | null
          document_id: string
          extracted_at: string | null
          id: string
          location_description: string | null
          notes: string | null
          project_id: string
          sheet_number: string | null
          source_type: string | null
          station: string
          station_numeric: number | null
          termination_type: string
          updated_at: string | null
          utility_name: string
          utility_type: string | null
          vision_data: Json | null
        }
        Insert: {
          chunk_id?: string | null
          confidence?: number | null
          created_at?: string | null
          document_id: string
          extracted_at?: string | null
          id?: string
          location_description?: string | null
          notes?: string | null
          project_id: string
          sheet_number?: string | null
          source_type?: string | null
          station: string
          station_numeric?: number | null
          termination_type: string
          updated_at?: string | null
          utility_name: string
          utility_type?: string | null
          vision_data?: Json | null
        }
        Update: {
          chunk_id?: string | null
          confidence?: number | null
          created_at?: string | null
          document_id?: string
          extracted_at?: string | null
          id?: string
          location_description?: string | null
          notes?: string | null
          project_id?: string
          sheet_number?: string | null
          source_type?: string | null
          station?: string
          station_numeric?: number | null
          termination_type?: string
          updated_at?: string | null
          utility_name?: string
          utility_type?: string | null
          vision_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "utility_termination_points_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: false
            referencedRelation: "document_chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "utility_termination_points_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "document_processing_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "utility_termination_points_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "utility_termination_points_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_quantity_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "utility_termination_points_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "utility_termination_points_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
          },
        ]
      }
      vision_job_events: {
        Row: {
          chunk_id: string | null
          created_at: string
          event_data: Json | null
          event_type: string
          id: string
          job_id: string
        }
        Insert: {
          chunk_id?: string | null
          created_at?: string
          event_data?: Json | null
          event_type: string
          id?: string
          job_id: string
        }
        Update: {
          chunk_id?: string | null
          created_at?: string
          event_data?: Json | null
          event_type?: string
          id?: string
          job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vision_job_events_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: false
            referencedRelation: "vision_processing_chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vision_job_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "vision_processing_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      vision_processing_chunks: {
        Row: {
          chunk_index: number
          completed_at: string | null
          cost_usd: number
          created_at: string
          crossings_found: number
          error_message: string | null
          id: string
          job_id: string
          metadata: Json | null
          page_count: number
          page_end: number
          page_start: number
          pages_processed: number
          processing_time_ms: number | null
          quantities_found: number
          retry_count: number
          started_at: string | null
          status: string
          termination_points_found: number
          tokens_input: number
          tokens_output: number
          updated_at: string
        }
        Insert: {
          chunk_index: number
          completed_at?: string | null
          cost_usd?: number
          created_at?: string
          crossings_found?: number
          error_message?: string | null
          id?: string
          job_id: string
          metadata?: Json | null
          page_count: number
          page_end: number
          page_start: number
          pages_processed?: number
          processing_time_ms?: number | null
          quantities_found?: number
          retry_count?: number
          started_at?: string | null
          status?: string
          termination_points_found?: number
          tokens_input?: number
          tokens_output?: number
          updated_at?: string
        }
        Update: {
          chunk_index?: number
          completed_at?: string | null
          cost_usd?: number
          created_at?: string
          crossings_found?: number
          error_message?: string | null
          id?: string
          job_id?: string
          metadata?: Json | null
          page_count?: number
          page_end?: number
          page_start?: number
          pages_processed?: number
          processing_time_ms?: number | null
          quantities_found?: number
          retry_count?: number
          started_at?: string | null
          status?: string
          termination_points_found?: number
          tokens_input?: number
          tokens_output?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vision_processing_chunks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "vision_processing_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      vision_processing_jobs: {
        Row: {
          chunks_completed: number
          chunks_failed: number
          completed_at: string | null
          created_at: string
          document_id: string
          error_message: string | null
          estimated_completion_at: string | null
          id: string
          job_key: string
          max_parallel_chunks: number
          max_retries: number
          metadata: Json | null
          pages_per_chunk: number
          pages_processed: number
          processing_mode: string
          project_id: string
          quantities_extracted: number
          retry_count: number
          started_at: string | null
          status: string
          total_chunks: number
          total_cost_usd: number
          total_pages: number
          updated_at: string
        }
        Insert: {
          chunks_completed?: number
          chunks_failed?: number
          completed_at?: string | null
          created_at?: string
          document_id: string
          error_message?: string | null
          estimated_completion_at?: string | null
          id?: string
          job_key: string
          max_parallel_chunks?: number
          max_retries?: number
          metadata?: Json | null
          pages_per_chunk?: number
          pages_processed?: number
          processing_mode?: string
          project_id: string
          quantities_extracted?: number
          retry_count?: number
          started_at?: string | null
          status?: string
          total_chunks: number
          total_cost_usd?: number
          total_pages: number
          updated_at?: string
        }
        Update: {
          chunks_completed?: number
          chunks_failed?: number
          completed_at?: string | null
          created_at?: string
          document_id?: string
          error_message?: string | null
          estimated_completion_at?: string | null
          id?: string
          job_key?: string
          max_parallel_chunks?: number
          max_retries?: number
          metadata?: Json | null
          pages_per_chunk?: number
          pages_processed?: number
          processing_mode?: string
          project_id?: string
          quantities_extracted?: number
          retry_count?: number
          started_at?: string | null
          status?: string
          total_chunks?: number
          total_cost_usd?: number
          total_pages?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vision_processing_jobs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "document_processing_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vision_processing_jobs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vision_processing_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_quantity_summary"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "vision_processing_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vision_processing_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
          },
        ]
      }
    }
    Views: {
      document_processing_status: {
        Row: {
          filename: string | null
          id: string | null
          overall_status: string | null
          project_id: string | null
          text_processing_status: string | null
          uploaded_at: string | null
          vision_cost_usd: number | null
          vision_processed_at: string | null
          vision_quantities_extracted: number | null
          vision_sheets_processed: number | null
          vision_status: string | null
        }
        Insert: {
          filename?: string | null
          id?: string | null
          overall_status?: never
          project_id?: string | null
          text_processing_status?: string | null
          uploaded_at?: string | null
          vision_cost_usd?: number | null
          vision_processed_at?: string | null
          vision_quantities_extracted?: number | null
          vision_sheets_processed?: number | null
          vision_status?: string | null
        }
        Update: {
          filename?: string | null
          id?: string | null
          overall_status?: never
          project_id?: string | null
          text_processing_status?: string | null
          uploaded_at?: string | null
          vision_cost_usd?: number | null
          vision_processed_at?: string | null
          vision_quantities_extracted?: number | null
          vision_sheets_processed?: number | null
          vision_status?: string | null
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
            foreignKeyName: "documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "utility_length_summary"
            referencedColumns: ["project_id"]
          },
        ]
      }
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
      utility_length_summary: {
        Row: {
          begin_sheet: string | null
          begin_station: string | null
          begin_station_numeric: number | null
          confidence: number | null
          end_sheet: string | null
          end_station: string | null
          end_station_numeric: number | null
          length_lf: number | null
          project_id: string | null
          project_name: string | null
          source_method: string | null
          utility_name: string | null
          utility_type: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      calculate_utility_length: {
        Args: { p_project_id: string; p_utility_name: string }
        Returns: {
          begin_sheet: string
          begin_station: string
          confidence: number
          end_sheet: string
          end_station: string
          length_lf: number
          method: string
          utility_name: string
        }[]
      }
      count_utility_crossings_by_type: {
        Args: { p_project_id: string }
        Returns: {
          crossing_utility: string
          existing_count: number
          proposed_count: number
          total_count: number
          utility_full_name: string
        }[]
      }
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
      get_estimated_time_remaining: {
        Args: { job_id: string }
        Returns: number
      }
      get_job_progress: { Args: { job_id: string }; Returns: number }
      get_user_organization_id: { Args: never; Returns: string }
      get_user_project_ids: {
        Args: never
        Returns: {
          project_id: string
        }[]
      }
      normalize_station: { Args: { station_text: string }; Returns: number }
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
          description: string
          id: string
          item_name: string
          item_type: string
          quantity: number
          sheet_number: string
          similarity: number
          station_from: string
          station_to: string
          unit: string
        }[]
      }
      search_termination_points: {
        Args: {
          p_limit?: number
          p_project_id: string
          p_termination_type?: string
          p_utility_search: string
        }
        Returns: {
          confidence: number
          id: string
          sheet_number: string
          similarity: number
          station: string
          station_numeric: number
          termination_type: string
          utility_name: string
        }[]
      }
      search_utility_crossings: {
        Args: {
          p_existing_only?: boolean
          p_limit?: number
          p_project_id: string
          p_sheet_number?: string
          p_utility_search?: string
        }
        Returns: {
          confidence: number
          crossing_utility: string
          elevation: number
          id: string
          is_existing: boolean
          is_proposed: boolean
          notes: string
          sheet_number: string
          similarity: number
          size: string
          station: string
          station_numeric: number
          utility_full_name: string
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

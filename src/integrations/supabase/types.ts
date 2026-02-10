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
      agencies: {
        Row: {
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      agreement_audit_log: {
        Row: {
          action: string
          changes: Json | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          ip_address: string | null
          performed_by: string | null
          performed_by_name: string | null
          performed_by_role: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          changes?: Json | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          ip_address?: string | null
          performed_by?: string | null
          performed_by_name?: string | null
          performed_by_role?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          changes?: Json | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          ip_address?: string | null
          performed_by?: string | null
          performed_by_name?: string | null
          performed_by_role?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agreement_audit_log_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "physician_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_audit_log_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_audit_log_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "provider_directory_public"
            referencedColumns: ["id"]
          },
        ]
      }
      agreement_notifications: {
        Row: {
          agreement_id: string
          created_at: string
          delivered: boolean | null
          error_message: string | null
          id: string
          notification_type: Database["public"]["Enums"]["notification_type"]
          recipient_email: string
          recipient_name: string | null
          resend_message_id: string | null
          sent_at: string | null
          subject: string
        }
        Insert: {
          agreement_id: string
          created_at?: string
          delivered?: boolean | null
          error_message?: string | null
          id?: string
          notification_type: Database["public"]["Enums"]["notification_type"]
          recipient_email: string
          recipient_name?: string | null
          resend_message_id?: string | null
          sent_at?: string | null
          subject: string
        }
        Update: {
          agreement_id?: string
          created_at?: string
          delivered?: boolean | null
          error_message?: string | null
          id?: string
          notification_type?: Database["public"]["Enums"]["notification_type"]
          recipient_email?: string
          recipient_name?: string | null
          resend_message_id?: string | null
          sent_at?: string | null
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "agreement_notifications_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "agreement_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_notifications_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "collaborative_agreements"
            referencedColumns: ["id"]
          },
        ]
      }
      agreement_providers: {
        Row: {
          agreement_id: string
          box_sign_signer_id: string | null
          chart_review_url: string | null
          created_at: string
          id: string
          is_active: boolean | null
          medallion_document_url: string | null
          provider_email: string
          provider_id: string | null
          provider_name: string
          provider_npi: string | null
          removed_at: string | null
          removed_reason: string | null
          signature_status: string | null
          signed_at: string | null
          start_date: string | null
        }
        Insert: {
          agreement_id: string
          box_sign_signer_id?: string | null
          chart_review_url?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          medallion_document_url?: string | null
          provider_email: string
          provider_id?: string | null
          provider_name: string
          provider_npi?: string | null
          removed_at?: string | null
          removed_reason?: string | null
          signature_status?: string | null
          signed_at?: string | null
          start_date?: string | null
        }
        Update: {
          agreement_id?: string
          box_sign_signer_id?: string | null
          chart_review_url?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          medallion_document_url?: string | null
          provider_email?: string
          provider_id?: string | null
          provider_name?: string
          provider_npi?: string | null
          removed_at?: string | null
          removed_reason?: string | null
          signature_status?: string | null
          signed_at?: string | null
          start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agreement_providers_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "agreement_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_providers_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "collaborative_agreements"
            referencedColumns: ["id"]
          },
        ]
      }
      agreement_tasks: {
        Row: {
          agreement_id: string | null
          assigned_at: string | null
          assigned_role: string | null
          assigned_to: string | null
          assigned_to_name: string | null
          auto_trigger: string | null
          blocked_reason: string | null
          blocked_until: string | null
          blockers: string | null
          category: Database["public"]["Enums"]["agreement_task_category"]
          checklist_items: Json | null
          completed_at: string | null
          completed_by: string | null
          compliance_risk: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          escalated: boolean | null
          escalated_at: string | null
          escalated_by: string | null
          expected_outcome: string | null
          external_url: string | null
          id: string
          is_auto_generated: boolean | null
          is_required: boolean | null
          links_json: Json | null
          meeting_id: string | null
          notes: string | null
          notification_sent_at: string | null
          notification_status: string | null
          physician_id: string | null
          priority: string | null
          provider_id: string | null
          related_event_id: string | null
          sort_order: number | null
          started_at: string | null
          state_abbreviation: string | null
          state_name: string | null
          status: Database["public"]["Enums"]["agreement_task_status"]
          task_purpose: string | null
          title: string
          transfer_id: string | null
          transfer_provider_id: string | null
          updated_at: string
        }
        Insert: {
          agreement_id?: string | null
          assigned_at?: string | null
          assigned_role?: string | null
          assigned_to?: string | null
          assigned_to_name?: string | null
          auto_trigger?: string | null
          blocked_reason?: string | null
          blocked_until?: string | null
          blockers?: string | null
          category?: Database["public"]["Enums"]["agreement_task_category"]
          checklist_items?: Json | null
          completed_at?: string | null
          completed_by?: string | null
          compliance_risk?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          escalated?: boolean | null
          escalated_at?: string | null
          escalated_by?: string | null
          expected_outcome?: string | null
          external_url?: string | null
          id?: string
          is_auto_generated?: boolean | null
          is_required?: boolean | null
          links_json?: Json | null
          meeting_id?: string | null
          notes?: string | null
          notification_sent_at?: string | null
          notification_status?: string | null
          physician_id?: string | null
          priority?: string | null
          provider_id?: string | null
          related_event_id?: string | null
          sort_order?: number | null
          started_at?: string | null
          state_abbreviation?: string | null
          state_name?: string | null
          status?: Database["public"]["Enums"]["agreement_task_status"]
          task_purpose?: string | null
          title: string
          transfer_id?: string | null
          transfer_provider_id?: string | null
          updated_at?: string
        }
        Update: {
          agreement_id?: string | null
          assigned_at?: string | null
          assigned_role?: string | null
          assigned_to?: string | null
          assigned_to_name?: string | null
          auto_trigger?: string | null
          blocked_reason?: string | null
          blocked_until?: string | null
          blockers?: string | null
          category?: Database["public"]["Enums"]["agreement_task_category"]
          checklist_items?: Json | null
          completed_at?: string | null
          completed_by?: string | null
          compliance_risk?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          escalated?: boolean | null
          escalated_at?: string | null
          escalated_by?: string | null
          expected_outcome?: string | null
          external_url?: string | null
          id?: string
          is_auto_generated?: boolean | null
          is_required?: boolean | null
          links_json?: Json | null
          meeting_id?: string | null
          notes?: string | null
          notification_sent_at?: string | null
          notification_status?: string | null
          physician_id?: string | null
          priority?: string | null
          provider_id?: string | null
          related_event_id?: string | null
          sort_order?: number | null
          started_at?: string | null
          state_abbreviation?: string | null
          state_name?: string | null
          status?: Database["public"]["Enums"]["agreement_task_status"]
          task_purpose?: string | null
          title?: string
          transfer_id?: string | null
          transfer_provider_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agreement_tasks_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "agreement_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_tasks_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "collaborative_agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "physician_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "provider_directory_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "physician_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "provider_directory_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "physician_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "provider_directory_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_tasks_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meeting_notification_emails"
            referencedColumns: ["meeting_id"]
          },
          {
            foreignKeyName: "agreement_tasks_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "supervision_meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_tasks_physician_id_fkey"
            columns: ["physician_id"]
            isOneToOne: false
            referencedRelation: "physician_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_tasks_physician_id_fkey"
            columns: ["physician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_tasks_physician_id_fkey"
            columns: ["physician_id"]
            isOneToOne: false
            referencedRelation: "provider_directory_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_tasks_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "physician_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_tasks_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_tasks_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_directory_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_tasks_related_event_id_fkey"
            columns: ["related_event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_tasks_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "agreement_transfers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_tasks_transfer_provider_id_fkey"
            columns: ["transfer_provider_id"]
            isOneToOne: false
            referencedRelation: "transfer_provider_status"
            referencedColumns: ["id"]
          },
        ]
      }
      agreement_transfers: {
        Row: {
          admin_override: boolean | null
          admin_override_at: string | null
          admin_override_by: string | null
          admin_override_reason: string | null
          affected_provider_count: number
          affected_provider_ids: string[]
          blocking_reasons: Json | null
          chart_review_frequency: string | null
          checklist_items: Json | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          effective_date: string | null
          first_meeting_scheduled_date: string | null
          id: string
          initiated_at: string
          initiated_by: string | null
          initiation_effective_date: string | null
          meeting_cadence: string | null
          new_agreement_renewal_date: string | null
          notes: string | null
          readiness_last_checked_at: string | null
          readiness_status: string
          source_agreement_id: string
          source_physician_email: string | null
          source_physician_id: string | null
          source_physician_name: string | null
          state_abbreviation: string
          state_name: string
          status: string
          target_agreement_id: string | null
          target_physician_email: string | null
          target_physician_id: string | null
          target_physician_name: string
          termination_effective_date: string | null
          updated_at: string
        }
        Insert: {
          admin_override?: boolean | null
          admin_override_at?: string | null
          admin_override_by?: string | null
          admin_override_reason?: string | null
          affected_provider_count?: number
          affected_provider_ids?: string[]
          blocking_reasons?: Json | null
          chart_review_frequency?: string | null
          checklist_items?: Json | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          effective_date?: string | null
          first_meeting_scheduled_date?: string | null
          id?: string
          initiated_at?: string
          initiated_by?: string | null
          initiation_effective_date?: string | null
          meeting_cadence?: string | null
          new_agreement_renewal_date?: string | null
          notes?: string | null
          readiness_last_checked_at?: string | null
          readiness_status?: string
          source_agreement_id: string
          source_physician_email?: string | null
          source_physician_id?: string | null
          source_physician_name?: string | null
          state_abbreviation: string
          state_name: string
          status?: string
          target_agreement_id?: string | null
          target_physician_email?: string | null
          target_physician_id?: string | null
          target_physician_name: string
          termination_effective_date?: string | null
          updated_at?: string
        }
        Update: {
          admin_override?: boolean | null
          admin_override_at?: string | null
          admin_override_by?: string | null
          admin_override_reason?: string | null
          affected_provider_count?: number
          affected_provider_ids?: string[]
          blocking_reasons?: Json | null
          chart_review_frequency?: string | null
          checklist_items?: Json | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          effective_date?: string | null
          first_meeting_scheduled_date?: string | null
          id?: string
          initiated_at?: string
          initiated_by?: string | null
          initiation_effective_date?: string | null
          meeting_cadence?: string | null
          new_agreement_renewal_date?: string | null
          notes?: string | null
          readiness_last_checked_at?: string | null
          readiness_status?: string
          source_agreement_id?: string
          source_physician_email?: string | null
          source_physician_id?: string | null
          source_physician_name?: string | null
          state_abbreviation?: string
          state_name?: string
          status?: string
          target_agreement_id?: string | null
          target_physician_email?: string | null
          target_physician_id?: string | null
          target_physician_name?: string
          termination_effective_date?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      agreement_workflow_steps: {
        Row: {
          agreement_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          notes: string | null
          started_at: string | null
          status: string
          step_description: string | null
          step_name: string
          step_number: number
        }
        Insert: {
          agreement_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          started_at?: string | null
          status?: string
          step_description?: string | null
          step_name: string
          step_number: number
        }
        Update: {
          agreement_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          started_at?: string | null
          status?: string
          step_description?: string | null
          step_name?: string
          step_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "agreement_workflow_steps_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "agreement_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_workflow_steps_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "collaborative_agreements"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          attestation_due_days: number | null
          attestation_required: boolean | null
          completed_attestations: number | null
          created_at: string
          created_by: string | null
          description: string | null
          ends_at: string
          event_type: string
          id: string
          meeting_link: string | null
          newsletter_article_id: string | null
          parent_event_id: string | null
          recording_link: string | null
          recurrence_rule: string | null
          starts_at: string
          status: string
          timezone: string | null
          title: string
          total_providers: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          attestation_due_days?: number | null
          attestation_required?: boolean | null
          completed_attestations?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at: string
          event_type?: string
          id?: string
          meeting_link?: string | null
          newsletter_article_id?: string | null
          parent_event_id?: string | null
          recording_link?: string | null
          recurrence_rule?: string | null
          starts_at: string
          status?: string
          timezone?: string | null
          title: string
          total_providers?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          attestation_due_days?: number | null
          attestation_required?: boolean | null
          completed_attestations?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string
          event_type?: string
          id?: string
          meeting_link?: string | null
          newsletter_article_id?: string | null
          parent_event_id?: string | null
          recording_link?: string | null
          recurrence_rule?: string | null
          starts_at?: string
          status?: string
          timezone?: string | null
          title?: string
          total_providers?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "physician_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "provider_directory_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_newsletter_article_id_fkey"
            columns: ["newsletter_article_id"]
            isOneToOne: false
            referencedRelation: "kb_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_parent_event_id_fkey"
            columns: ["parent_event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "physician_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "provider_directory_public"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborative_agreements: {
        Row: {
          admin_override: boolean | null
          admin_override_at: string | null
          admin_override_by: string | null
          admin_override_reason: string | null
          agreement_document_url: string | null
          blocking_reasons: Json | null
          box_sign_request_id: string | null
          box_sign_status: string | null
          chart_review_frequency: string | null
          chart_review_required: boolean | null
          created_at: string
          created_by: string | null
          end_date: string | null
          id: string
          medallion_document_url: string | null
          medallion_id: string | null
          meeting_cadence: string | null
          next_renewal_date: string | null
          physician_email: string | null
          physician_id: string | null
          physician_name: string | null
          physician_npi: string | null
          physician_signed_at: string | null
          readiness_last_checked_at: string | null
          readiness_status: string
          renewal_cadence: string | null
          source: string | null
          start_date: string | null
          state_abbreviation: string
          state_id: string
          state_name: string
          supervision_type: string | null
          terminated_at: string | null
          terminated_by: string | null
          termination_document_url: string | null
          termination_reason: string | null
          updated_at: string
          workflow_status: Database["public"]["Enums"]["agreement_workflow_status"]
        }
        Insert: {
          admin_override?: boolean | null
          admin_override_at?: string | null
          admin_override_by?: string | null
          admin_override_reason?: string | null
          agreement_document_url?: string | null
          blocking_reasons?: Json | null
          box_sign_request_id?: string | null
          box_sign_status?: string | null
          chart_review_frequency?: string | null
          chart_review_required?: boolean | null
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          medallion_document_url?: string | null
          medallion_id?: string | null
          meeting_cadence?: string | null
          next_renewal_date?: string | null
          physician_email?: string | null
          physician_id?: string | null
          physician_name?: string | null
          physician_npi?: string | null
          physician_signed_at?: string | null
          readiness_last_checked_at?: string | null
          readiness_status?: string
          renewal_cadence?: string | null
          source?: string | null
          start_date?: string | null
          state_abbreviation: string
          state_id: string
          state_name: string
          supervision_type?: string | null
          terminated_at?: string | null
          terminated_by?: string | null
          termination_document_url?: string | null
          termination_reason?: string | null
          updated_at?: string
          workflow_status?: Database["public"]["Enums"]["agreement_workflow_status"]
        }
        Update: {
          admin_override?: boolean | null
          admin_override_at?: string | null
          admin_override_by?: string | null
          admin_override_reason?: string | null
          agreement_document_url?: string | null
          blocking_reasons?: Json | null
          box_sign_request_id?: string | null
          box_sign_status?: string | null
          chart_review_frequency?: string | null
          chart_review_required?: boolean | null
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          medallion_document_url?: string | null
          medallion_id?: string | null
          meeting_cadence?: string | null
          next_renewal_date?: string | null
          physician_email?: string | null
          physician_id?: string | null
          physician_name?: string | null
          physician_npi?: string | null
          physician_signed_at?: string | null
          readiness_last_checked_at?: string | null
          readiness_status?: string
          renewal_cadence?: string | null
          source?: string | null
          start_date?: string | null
          state_abbreviation?: string
          state_id?: string
          state_name?: string
          supervision_type?: string | null
          terminated_at?: string | null
          terminated_by?: string | null
          termination_document_url?: string | null
          termination_reason?: string | null
          updated_at?: string
          workflow_status?: Database["public"]["Enums"]["agreement_workflow_status"]
        }
        Relationships: []
      }
      compliance_status_log: {
        Row: {
          computed_from: Json | null
          created_at: string
          id: string
          new_status: string
          previous_status: string | null
          provider_id: string
          reason: string | null
          state_abbreviation: string
        }
        Insert: {
          computed_from?: Json | null
          created_at?: string
          id?: string
          new_status: string
          previous_status?: string | null
          provider_id: string
          reason?: string | null
          state_abbreviation: string
        }
        Update: {
          computed_from?: Json | null
          created_at?: string
          id?: string
          new_status?: string
          previous_status?: string | null
          provider_id?: string
          reason?: string | null
          state_abbreviation?: string
        }
        Relationships: []
      }
      ehr_activation_events: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          created_at: string
          event_type: string
          evidence_link: string | null
          id: string
          new_status: string | null
          notes: string | null
          previous_status: string | null
          provider_id: string
          state_abbreviation: string
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          event_type: string
          evidence_link?: string | null
          id?: string
          new_status?: string | null
          notes?: string | null
          previous_status?: string | null
          provider_id: string
          state_abbreviation: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          event_type?: string
          evidence_link?: string | null
          id?: string
          new_status?: string | null
          notes?: string | null
          previous_status?: string | null
          provider_id?: string
          state_abbreviation?: string
        }
        Relationships: []
      }
      enhancement_registry: {
        Row: {
          category: string
          created_at: string
          description: string | null
          id: string
          priority: string
          requested_by: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          priority?: string
          requested_by?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          priority?: string
          requested_by?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      event_activity_log: {
        Row: {
          activity_type: string
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          created_at: string
          description: string
          event_id: string
          id: string
          metadata: Json | null
        }
        Insert: {
          activity_type: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          created_at?: string
          description: string
          event_id: string
          id?: string
          metadata?: Json | null
        }
        Update: {
          activity_type?: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          created_at?: string
          description?: string
          event_id?: string
          id?: string
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "event_activity_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "physician_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_activity_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_activity_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "provider_directory_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_activity_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_attestations: {
        Row: {
          completed_at: string | null
          completed_by_user_id: string | null
          completion_source: string | null
          created_at: string
          due_at: string
          event_id: string
          id: string
          is_active_at_creation: boolean | null
          last_reminder_at: string | null
          notes: string | null
          pod_id: string | null
          provider_email: string | null
          provider_id: string
          provider_name: string
          reminder_count: number | null
          status: Database["public"]["Enums"]["attestation_status"]
          task_id: string | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completed_by_user_id?: string | null
          completion_source?: string | null
          created_at?: string
          due_at: string
          event_id: string
          id?: string
          is_active_at_creation?: boolean | null
          last_reminder_at?: string | null
          notes?: string | null
          pod_id?: string | null
          provider_email?: string | null
          provider_id: string
          provider_name: string
          reminder_count?: number | null
          status?: Database["public"]["Enums"]["attestation_status"]
          task_id?: string | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completed_by_user_id?: string | null
          completion_source?: string | null
          created_at?: string
          due_at?: string
          event_id?: string
          id?: string
          is_active_at_creation?: boolean | null
          last_reminder_at?: string | null
          notes?: string | null
          pod_id?: string | null
          provider_email?: string | null
          provider_id?: string
          provider_name?: string
          reminder_count?: number | null
          status?: Database["public"]["Enums"]["attestation_status"]
          task_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_attestations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_attestations_pod_id_fkey"
            columns: ["pod_id"]
            isOneToOne: false
            referencedRelation: "pods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_attestations_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "physician_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_attestations_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_attestations_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_directory_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_attestations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "agreement_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_articles: {
        Row: {
          category: string
          content: string | null
          content_type: string
          created_at: string
          created_by: string | null
          featured_order: number | null
          id: string
          is_featured: boolean | null
          last_reviewed_at: string | null
          last_reviewed_by: string | null
          notion_url: string | null
          owner_id: string | null
          owner_name: string | null
          published: boolean | null
          review_cycle_days: number | null
          slug: string | null
          summary: string | null
          tags: string[] | null
          title: string
          updated_at: string
          view_count: number | null
          visibility_roles: string[] | null
        }
        Insert: {
          category?: string
          content?: string | null
          content_type?: string
          created_at?: string
          created_by?: string | null
          featured_order?: number | null
          id?: string
          is_featured?: boolean | null
          last_reviewed_at?: string | null
          last_reviewed_by?: string | null
          notion_url?: string | null
          owner_id?: string | null
          owner_name?: string | null
          published?: boolean | null
          review_cycle_days?: number | null
          slug?: string | null
          summary?: string | null
          tags?: string[] | null
          title: string
          updated_at?: string
          view_count?: number | null
          visibility_roles?: string[] | null
        }
        Update: {
          category?: string
          content?: string | null
          content_type?: string
          created_at?: string
          created_by?: string | null
          featured_order?: number | null
          id?: string
          is_featured?: boolean | null
          last_reviewed_at?: string | null
          last_reviewed_by?: string | null
          notion_url?: string | null
          owner_id?: string | null
          owner_name?: string | null
          published?: boolean | null
          review_cycle_days?: number | null
          slug?: string | null
          summary?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string
          view_count?: number | null
          visibility_roles?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "kb_articles_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "physician_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_articles_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_articles_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "provider_directory_public"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_categories: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          icon: string | null
          id: string
          name: string
          sort_order: number | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          name: string
          sort_order?: number | null
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      meeting_attendees: {
        Row: {
          assigned_slot: string | null
          attendance_status: string | null
          confirmed_at: string | null
          created_at: string
          has_rsvped: boolean | null
          id: string
          meeting_id: string
          notes: string | null
          provider_email: string
          provider_id: string
          provider_name: string
          rsvp_at: string | null
          rsvp_slot: string | null
        }
        Insert: {
          assigned_slot?: string | null
          attendance_status?: string | null
          confirmed_at?: string | null
          created_at?: string
          has_rsvped?: boolean | null
          id?: string
          meeting_id: string
          notes?: string | null
          provider_email: string
          provider_id: string
          provider_name: string
          rsvp_at?: string | null
          rsvp_slot?: string | null
        }
        Update: {
          assigned_slot?: string | null
          attendance_status?: string | null
          confirmed_at?: string | null
          created_at?: string
          has_rsvped?: boolean | null
          id?: string
          meeting_id?: string
          notes?: string | null
          provider_email?: string
          provider_id?: string
          provider_name?: string
          rsvp_at?: string | null
          rsvp_slot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meeting_attendees_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meeting_notification_emails"
            referencedColumns: ["meeting_id"]
          },
          {
            foreignKeyName: "meeting_attendees_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "supervision_meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      milestone_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          created_at: string
          details: Json | null
          id: string
          milestone_task_id: string | null
          provider_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          milestone_task_id?: string | null
          provider_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          milestone_task_id?: string | null
          provider_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "milestone_audit_log_milestone_task_id_fkey"
            columns: ["milestone_task_id"]
            isOneToOne: false
            referencedRelation: "milestone_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_audit_log_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "physician_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_audit_log_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_audit_log_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_directory_public"
            referencedColumns: ["id"]
          },
        ]
      }
      milestone_tasks: {
        Row: {
          assigned_to: string | null
          assigned_to_name: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          description: string | null
          due_date: string
          id: string
          milestone_date: string
          milestone_type: string
          milestone_year: number
          pod_id: string | null
          provider_email: string | null
          provider_id: string
          provider_name: string
          slack_template: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          assigned_to_name?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          description?: string | null
          due_date: string
          id?: string
          milestone_date: string
          milestone_type: string
          milestone_year: number
          pod_id?: string | null
          provider_email?: string | null
          provider_id: string
          provider_name: string
          slack_template?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          assigned_to_name?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          description?: string | null
          due_date?: string
          id?: string
          milestone_date?: string
          milestone_type?: string
          milestone_year?: number
          pod_id?: string | null
          provider_email?: string | null
          provider_id?: string
          provider_name?: string
          slack_template?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "milestone_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "physician_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "provider_directory_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_tasks_pod_id_fkey"
            columns: ["pod_id"]
            isOneToOne: false
            referencedRelation: "pods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_tasks_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "physician_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_tasks_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_tasks_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_directory_public"
            referencedColumns: ["id"]
          },
        ]
      }
      pods: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          pod_lead_email: string | null
          pod_lead_id: string | null
          pod_lead_name: string | null
          slack_channel: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          pod_lead_email?: string | null
          pod_lead_id?: string | null
          pod_lead_name?: string | null
          slack_channel?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          pod_lead_email?: string | null
          pod_lead_id?: string | null
          pod_lead_name?: string | null
          slack_channel?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pods_pod_lead_id_fkey"
            columns: ["pod_lead_id"]
            isOneToOne: false
            referencedRelation: "physician_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pods_pod_lead_id_fkey"
            columns: ["pod_lead_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pods_pod_lead_id_fkey"
            columns: ["pod_lead_id"]
            isOneToOne: false
            referencedRelation: "provider_directory_public"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          activation_status: string | null
          actively_licensed_states: string | null
          address_city: string | null
          address_line_1: string | null
          address_line_2: string | null
          address_state: string | null
          agency_id: string | null
          auto_renew_licenses: boolean | null
          avatar_url: string | null
          bio: string | null
          birthday: string | null
          board_certificates: string | null
          caqh_number: string | null
          chart_review_folder_url: string | null
          collaborative_physician: string | null
          created_at: string
          credentials: string | null
          date_of_birth: string | null
          email: string
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          employment_end_date: string | null
          employment_offer_date: string | null
          employment_start_date: string | null
          employment_status: string | null
          employment_type: string | null
          first_name: string | null
          full_name: string | null
          has_caqh_management: boolean | null
          has_collaborative_agreements: boolean | null
          home_address: string | null
          id: string
          languages: string | null
          last_name: string | null
          manages_own_renewals: boolean | null
          medallion_id: string | null
          middle_name: string | null
          milestone_visibility: string | null
          min_patient_age: string | null
          notes: string | null
          npi_number: string | null
          onboarding_completed: boolean | null
          onboarding_completed_at: string | null
          patient_age_preference: string | null
          personal_email: string | null
          phone_number: string | null
          pod_id: string | null
          postal_code: string | null
          practice_restrictions: string | null
          preferred_name: string | null
          primary_specialty: string | null
          profession: string | null
          pronoun: string | null
          secondary_contact_email: string | null
          service_offerings: string | null
          services_offered: string | null
          start_date_on_network: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          activation_status?: string | null
          actively_licensed_states?: string | null
          address_city?: string | null
          address_line_1?: string | null
          address_line_2?: string | null
          address_state?: string | null
          agency_id?: string | null
          auto_renew_licenses?: boolean | null
          avatar_url?: string | null
          bio?: string | null
          birthday?: string | null
          board_certificates?: string | null
          caqh_number?: string | null
          chart_review_folder_url?: string | null
          collaborative_physician?: string | null
          created_at?: string
          credentials?: string | null
          date_of_birth?: string | null
          email: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employment_end_date?: string | null
          employment_offer_date?: string | null
          employment_start_date?: string | null
          employment_status?: string | null
          employment_type?: string | null
          first_name?: string | null
          full_name?: string | null
          has_caqh_management?: boolean | null
          has_collaborative_agreements?: boolean | null
          home_address?: string | null
          id?: string
          languages?: string | null
          last_name?: string | null
          manages_own_renewals?: boolean | null
          medallion_id?: string | null
          middle_name?: string | null
          milestone_visibility?: string | null
          min_patient_age?: string | null
          notes?: string | null
          npi_number?: string | null
          onboarding_completed?: boolean | null
          onboarding_completed_at?: string | null
          patient_age_preference?: string | null
          personal_email?: string | null
          phone_number?: string | null
          pod_id?: string | null
          postal_code?: string | null
          practice_restrictions?: string | null
          preferred_name?: string | null
          primary_specialty?: string | null
          profession?: string | null
          pronoun?: string | null
          secondary_contact_email?: string | null
          service_offerings?: string | null
          services_offered?: string | null
          start_date_on_network?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          activation_status?: string | null
          actively_licensed_states?: string | null
          address_city?: string | null
          address_line_1?: string | null
          address_line_2?: string | null
          address_state?: string | null
          agency_id?: string | null
          auto_renew_licenses?: boolean | null
          avatar_url?: string | null
          bio?: string | null
          birthday?: string | null
          board_certificates?: string | null
          caqh_number?: string | null
          chart_review_folder_url?: string | null
          collaborative_physician?: string | null
          created_at?: string
          credentials?: string | null
          date_of_birth?: string | null
          email?: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employment_end_date?: string | null
          employment_offer_date?: string | null
          employment_start_date?: string | null
          employment_status?: string | null
          employment_type?: string | null
          first_name?: string | null
          full_name?: string | null
          has_caqh_management?: boolean | null
          has_collaborative_agreements?: boolean | null
          home_address?: string | null
          id?: string
          languages?: string | null
          last_name?: string | null
          manages_own_renewals?: boolean | null
          medallion_id?: string | null
          middle_name?: string | null
          milestone_visibility?: string | null
          min_patient_age?: string | null
          notes?: string | null
          npi_number?: string | null
          onboarding_completed?: boolean | null
          onboarding_completed_at?: string | null
          patient_age_preference?: string | null
          personal_email?: string | null
          phone_number?: string | null
          pod_id?: string | null
          postal_code?: string | null
          practice_restrictions?: string | null
          preferred_name?: string | null
          primary_specialty?: string | null
          profession?: string | null
          pronoun?: string | null
          secondary_contact_email?: string | null
          service_offerings?: string | null
          services_offered?: string | null
          start_date_on_network?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_pod_id_fkey"
            columns: ["pod_id"]
            isOneToOne: false
            referencedRelation: "pods"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_license_applications: {
        Row: {
          application_submitted_date: string | null
          created_at: string
          expected_approval_date: string | null
          id: string
          notes: string | null
          profile_id: string
          state_abbreviation: string
          status: string | null
          updated_at: string
        }
        Insert: {
          application_submitted_date?: string | null
          created_at?: string
          expected_approval_date?: string | null
          id?: string
          notes?: string | null
          profile_id: string
          state_abbreviation: string
          status?: string | null
          updated_at?: string
        }
        Update: {
          application_submitted_date?: string | null
          created_at?: string
          expected_approval_date?: string | null
          id?: string
          notes?: string | null
          profile_id?: string
          state_abbreviation?: string
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_license_applications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "physician_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_license_applications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_license_applications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "provider_directory_public"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_licenses: {
        Row: {
          collab_agreement_id: string | null
          created_at: string
          expiration_date: string | null
          id: string
          issue_date: string | null
          license_number: string | null
          license_type: string | null
          notes: string | null
          profile_id: string | null
          provider_email: string | null
          requires_collab_agreement: boolean | null
          state_abbreviation: string
          status: string | null
          updated_at: string
        }
        Insert: {
          collab_agreement_id?: string | null
          created_at?: string
          expiration_date?: string | null
          id?: string
          issue_date?: string | null
          license_number?: string | null
          license_type?: string | null
          notes?: string | null
          profile_id?: string | null
          provider_email?: string | null
          requires_collab_agreement?: boolean | null
          state_abbreviation: string
          status?: string | null
          updated_at?: string
        }
        Update: {
          collab_agreement_id?: string | null
          created_at?: string
          expiration_date?: string | null
          id?: string
          issue_date?: string | null
          license_number?: string | null
          license_type?: string | null
          notes?: string | null
          profile_id?: string | null
          provider_email?: string | null
          requires_collab_agreement?: boolean | null
          state_abbreviation?: string
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_licenses_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "physician_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_licenses_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_licenses_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "provider_directory_public"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_meeting_compliance: {
        Row: {
          attended: boolean | null
          attended_at: string | null
          created_at: string
          id: string
          meeting_id: string
          meeting_month: string
          provider_id: string
          required: boolean
          state_abbreviation: string
          updated_at: string
        }
        Insert: {
          attended?: boolean | null
          attended_at?: string | null
          created_at?: string
          id?: string
          meeting_id: string
          meeting_month: string
          provider_id: string
          required?: boolean
          state_abbreviation: string
          updated_at?: string
        }
        Update: {
          attended?: boolean | null
          attended_at?: string | null
          created_at?: string
          id?: string
          meeting_id?: string
          meeting_month?: string
          provider_id?: string
          required?: boolean
          state_abbreviation?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_meeting_compliance_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meeting_notification_emails"
            referencedColumns: ["meeting_id"]
          },
          {
            foreignKeyName: "provider_meeting_compliance_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "supervision_meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_meeting_compliance_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "physician_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_meeting_compliance_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_meeting_compliance_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_directory_public"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_state_collab_decisions: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision: string
          decision_notes: string | null
          id: string
          profile_id: string
          state_abbreviation: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision: string
          decision_notes?: string | null
          id?: string
          profile_id: string
          state_abbreviation: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          decision_notes?: string | null
          id?: string
          profile_id?: string
          state_abbreviation?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_state_collab_decisions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "physician_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_state_collab_decisions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_state_collab_decisions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "provider_directory_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_state_collab_decisions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "physician_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_state_collab_decisions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_state_collab_decisions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "provider_directory_public"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_state_status: {
        Row: {
          activation_effective_date: string | null
          activation_notes: string | null
          compliance_reason: string | null
          compliance_status: string | null
          created_at: string
          deactivation_effective_date: string | null
          ehr_activated_at: string | null
          ehr_activated_by: string | null
          ehr_activation_status: Database["public"]["Enums"]["ehr_activation_status"]
          ehr_deactivated_at: string | null
          ehr_deactivated_by: string | null
          id: string
          mismatch_type: Database["public"]["Enums"]["mismatch_type"] | null
          override_expires_at: string | null
          override_reason: string | null
          provider_id: string
          readiness_last_evaluated_at: string | null
          readiness_override: boolean | null
          readiness_reason: string | null
          readiness_status: Database["public"]["Enums"]["readiness_status"]
          state_abbreviation: string
          updated_at: string
        }
        Insert: {
          activation_effective_date?: string | null
          activation_notes?: string | null
          compliance_reason?: string | null
          compliance_status?: string | null
          created_at?: string
          deactivation_effective_date?: string | null
          ehr_activated_at?: string | null
          ehr_activated_by?: string | null
          ehr_activation_status?: Database["public"]["Enums"]["ehr_activation_status"]
          ehr_deactivated_at?: string | null
          ehr_deactivated_by?: string | null
          id?: string
          mismatch_type?: Database["public"]["Enums"]["mismatch_type"] | null
          override_expires_at?: string | null
          override_reason?: string | null
          provider_id: string
          readiness_last_evaluated_at?: string | null
          readiness_override?: boolean | null
          readiness_reason?: string | null
          readiness_status?: Database["public"]["Enums"]["readiness_status"]
          state_abbreviation: string
          updated_at?: string
        }
        Update: {
          activation_effective_date?: string | null
          activation_notes?: string | null
          compliance_reason?: string | null
          compliance_status?: string | null
          created_at?: string
          deactivation_effective_date?: string | null
          ehr_activated_at?: string | null
          ehr_activated_by?: string | null
          ehr_activation_status?: Database["public"]["Enums"]["ehr_activation_status"]
          ehr_deactivated_at?: string | null
          ehr_deactivated_by?: string | null
          id?: string
          mismatch_type?: Database["public"]["Enums"]["mismatch_type"] | null
          override_expires_at?: string | null
          override_reason?: string | null
          provider_id?: string
          readiness_last_evaluated_at?: string | null
          readiness_override?: boolean | null
          readiness_reason?: string | null
          readiness_status?: Database["public"]["Enums"]["readiness_status"]
          state_abbreviation?: string
          updated_at?: string
        }
        Relationships: []
      }
      reimbursement_requests: {
        Row: {
          admin_hours_spent: number | null
          admin_time_total: number | null
          application_fee_amount: number | null
          application_fee_receipt_url: string | null
          created_at: string
          description: string | null
          hourly_rate: number
          id: string
          license_application_id: string | null
          notes: string | null
          processed_at: string | null
          processed_by: string | null
          provider_id: string
          provider_name: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          state_abbreviation: string
          status: string
          submitted_at: string | null
          total_reimbursement: number | null
          updated_at: string
        }
        Insert: {
          admin_hours_spent?: number | null
          admin_time_total?: number | null
          application_fee_amount?: number | null
          application_fee_receipt_url?: string | null
          created_at?: string
          description?: string | null
          hourly_rate?: number
          id?: string
          license_application_id?: string | null
          notes?: string | null
          processed_at?: string | null
          processed_by?: string | null
          provider_id: string
          provider_name: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          state_abbreviation: string
          status?: string
          submitted_at?: string | null
          total_reimbursement?: number | null
          updated_at?: string
        }
        Update: {
          admin_hours_spent?: number | null
          admin_time_total?: number | null
          application_fee_amount?: number | null
          application_fee_receipt_url?: string | null
          created_at?: string
          description?: string | null
          hourly_rate?: number
          id?: string
          license_application_id?: string | null
          notes?: string | null
          processed_at?: string | null
          processed_by?: string | null
          provider_id?: string
          provider_name?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          state_abbreviation?: string
          status?: string
          submitted_at?: string | null
          total_reimbursement?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reimbursement_requests_license_application_id_fkey"
            columns: ["license_application_id"]
            isOneToOne: false
            referencedRelation: "provider_license_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reimbursement_requests_processed_by_fkey"
            columns: ["processed_by"]
            isOneToOne: false
            referencedRelation: "physician_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reimbursement_requests_processed_by_fkey"
            columns: ["processed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reimbursement_requests_processed_by_fkey"
            columns: ["processed_by"]
            isOneToOne: false
            referencedRelation: "provider_directory_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reimbursement_requests_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "physician_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reimbursement_requests_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reimbursement_requests_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_directory_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reimbursement_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "physician_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reimbursement_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reimbursement_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "provider_directory_public"
            referencedColumns: ["id"]
          },
        ]
      }
      sensitive_data_log: {
        Row: {
          action: string
          created_at: string
          detected_pattern: string | null
          entity_id: string | null
          entity_type: string
          field_name: string
          id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          detected_pattern?: string | null
          entity_id?: string | null
          entity_type?: string
          field_name: string
          id?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          detected_pattern?: string | null
          entity_id?: string | null
          entity_type?: string
          field_name?: string
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      state_compliance_requirements: {
        Row: {
          ca_meeting_cadence: string | null
          ca_required: boolean | null
          collab_notes: string | null
          collab_requirement_type:
            | Database["public"]["Enums"]["collab_requirement_type"]
            | null
          created_at: string | null
          fpa_requirements_summary: string | null
          fpa_status: string | null
          id: string
          independent_practice_requirements: string | null
          knowledge_base_url: string | null
          licenses: string | null
          meeting_months: number[] | null
          nlc: boolean | null
          np_md_ratio: string | null
          np_prohibited: boolean | null
          rxr_required: boolean | null
          state_abbreviation: string
          state_name: string
          steps_to_confirm_eligibility: string | null
          updated_at: string | null
        }
        Insert: {
          ca_meeting_cadence?: string | null
          ca_required?: boolean | null
          collab_notes?: string | null
          collab_requirement_type?:
            | Database["public"]["Enums"]["collab_requirement_type"]
            | null
          created_at?: string | null
          fpa_requirements_summary?: string | null
          fpa_status?: string | null
          id?: string
          independent_practice_requirements?: string | null
          knowledge_base_url?: string | null
          licenses?: string | null
          meeting_months?: number[] | null
          nlc?: boolean | null
          np_md_ratio?: string | null
          np_prohibited?: boolean | null
          rxr_required?: boolean | null
          state_abbreviation: string
          state_name: string
          steps_to_confirm_eligibility?: string | null
          updated_at?: string | null
        }
        Update: {
          ca_meeting_cadence?: string | null
          ca_required?: boolean | null
          collab_notes?: string | null
          collab_requirement_type?:
            | Database["public"]["Enums"]["collab_requirement_type"]
            | null
          created_at?: string | null
          fpa_requirements_summary?: string | null
          fpa_status?: string | null
          id?: string
          independent_practice_requirements?: string | null
          knowledge_base_url?: string | null
          licenses?: string | null
          meeting_months?: number[] | null
          nlc?: boolean | null
          np_md_ratio?: string | null
          np_prohibited?: boolean | null
          rxr_required?: boolean | null
          state_abbreviation?: string
          state_name?: string
          steps_to_confirm_eligibility?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      supervision_meetings: {
        Row: {
          agreement_id: string
          completed_at: string | null
          created_at: string
          duration_minutes: number | null
          id: string
          is_company_wide: boolean | null
          location: string | null
          meeting_month: string | null
          meeting_type: string | null
          notes: string | null
          physician_id: string | null
          scheduled_date: string
          state_abbreviation: string | null
          state_name: string | null
          status: string | null
          time_slot: string | null
          video_link: string | null
        }
        Insert: {
          agreement_id: string
          completed_at?: string | null
          created_at?: string
          duration_minutes?: number | null
          id?: string
          is_company_wide?: boolean | null
          location?: string | null
          meeting_month?: string | null
          meeting_type?: string | null
          notes?: string | null
          physician_id?: string | null
          scheduled_date: string
          state_abbreviation?: string | null
          state_name?: string | null
          status?: string | null
          time_slot?: string | null
          video_link?: string | null
        }
        Update: {
          agreement_id?: string
          completed_at?: string | null
          created_at?: string
          duration_minutes?: number | null
          id?: string
          is_company_wide?: boolean | null
          location?: string | null
          meeting_month?: string | null
          meeting_type?: string | null
          notes?: string | null
          physician_id?: string | null
          scheduled_date?: string
          state_abbreviation?: string | null
          state_name?: string | null
          status?: string | null
          time_slot?: string | null
          video_link?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supervision_meetings_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "agreement_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervision_meetings_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "collaborative_agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervision_meetings_physician_id_fkey"
            columns: ["physician_id"]
            isOneToOne: false
            referencedRelation: "physician_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervision_meetings_physician_id_fkey"
            columns: ["physician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervision_meetings_physician_id_fkey"
            columns: ["physician_id"]
            isOneToOne: false
            referencedRelation: "provider_directory_public"
            referencedColumns: ["id"]
          },
        ]
      }
      system_config: {
        Row: {
          description: string | null
          id: string
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          id?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          description?: string | null
          id?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      transfer_activity_log: {
        Row: {
          activity_type: string
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          created_at: string | null
          description: string
          id: string
          metadata: Json | null
          task_id: string | null
          transfer_id: string
        }
        Insert: {
          activity_type: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          created_at?: string | null
          description: string
          id?: string
          metadata?: Json | null
          task_id?: string | null
          transfer_id: string
        }
        Update: {
          activity_type?: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          created_at?: string | null
          description?: string
          id?: string
          metadata?: Json | null
          task_id?: string | null
          transfer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfer_activity_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "physician_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_activity_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_activity_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "provider_directory_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_activity_log_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "agreement_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_activity_log_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "agreement_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      transfer_provider_status: {
        Row: {
          blocked_reason: string | null
          blocked_until: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          escalated: boolean | null
          escalated_at: string | null
          id: string
          last_activity_at: string | null
          notes: string | null
          provider_email: string | null
          provider_id: string
          provider_name: string
          status: string
          transfer_id: string
          updated_at: string
        }
        Insert: {
          blocked_reason?: string | null
          blocked_until?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          escalated?: boolean | null
          escalated_at?: string | null
          id?: string
          last_activity_at?: string | null
          notes?: string | null
          provider_email?: string | null
          provider_id: string
          provider_name: string
          status?: string
          transfer_id: string
          updated_at?: string
        }
        Update: {
          blocked_reason?: string | null
          blocked_until?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          escalated?: boolean | null
          escalated_at?: string | null
          id?: string
          last_activity_at?: string | null
          notes?: string | null
          provider_email?: string | null
          provider_id?: string
          provider_name?: string
          status?: string
          transfer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfer_provider_status_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "agreement_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      transfer_task_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_default: boolean | null
          name: string
          phase: string
          state_abbreviation: string | null
          tasks: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          phase: string
          state_abbreviation?: string | null
          tasks?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          phase?: string
          state_abbreviation?: string | null
          tasks?: Json
          updated_at?: string
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
          role: Database["public"]["Enums"]["app_role"]
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
      workflow_overrides: {
        Row: {
          action: string
          blocking_reasons_at_override: Json | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          overridden_by: string | null
          overridden_by_name: string | null
          reason: string
        }
        Insert: {
          action: string
          blocking_reasons_at_override?: Json | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          overridden_by?: string | null
          overridden_by_name?: string | null
          reason: string
        }
        Update: {
          action?: string
          blocking_reasons_at_override?: Json | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          overridden_by?: string | null
          overridden_by_name?: string | null
          reason?: string
        }
        Relationships: []
      }
    }
    Views: {
      agreement_summary: {
        Row: {
          active_provider_count: number | null
          ca_meeting_cadence: string | null
          ca_required: boolean | null
          chart_review_frequency: string | null
          chart_review_required: boolean | null
          created_at: string | null
          end_date: string | null
          fpa_status: string | null
          id: string | null
          meeting_cadence: string | null
          meeting_months: number[] | null
          next_meeting_date: string | null
          next_renewal_date: string | null
          pending_task_count: number | null
          physician_email: string | null
          physician_id: string | null
          physician_name: string | null
          start_date: string | null
          state_abbreviation: string | null
          state_name: string | null
          terminated_at: string | null
          termination_reason: string | null
          workflow_status:
            | Database["public"]["Enums"]["agreement_workflow_status"]
            | null
        }
        Relationships: []
      }
      meeting_notification_emails: {
        Row: {
          assigned_slot: string | null
          attendance_status: string | null
          has_rsvped: boolean | null
          is_company_wide: boolean | null
          meeting_id: string | null
          meeting_month: string | null
          provider_email: string | null
          provider_id: string | null
          provider_name: string | null
          rsvp_slot: string | null
          scheduled_date: string | null
          time_slot: string | null
        }
        Relationships: []
      }
      physician_profiles: {
        Row: {
          active_agreements_count: number | null
          active_states: string[] | null
          avatar_url: string | null
          created_at: string | null
          credentials: string | null
          email: string | null
          employment_status: string | null
          full_name: string | null
          id: string | null
          npi_number: string | null
          phone_number: string | null
          primary_specialty: string | null
          supervised_providers_count: number | null
          user_id: string | null
        }
        Relationships: []
      }
      provider_directory_public: {
        Row: {
          activation_status: string | null
          actively_licensed_states: string | null
          address_city: string | null
          address_line_1: string | null
          address_line_2: string | null
          address_state: string | null
          agency_id: string | null
          avatar_url: string | null
          bio: string | null
          birthday: string | null
          created_at: string | null
          credentials: string | null
          date_of_birth: string | null
          email: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          employment_status: string | null
          employment_type: string | null
          first_name: string | null
          full_name: string | null
          home_address: string | null
          id: string | null
          languages: string | null
          last_name: string | null
          manages_own_renewals: boolean | null
          min_patient_age: string | null
          npi_number: string | null
          onboarding_completed: boolean | null
          patient_age_preference: string | null
          personal_email: string | null
          phone_number: string | null
          pod_id: string | null
          postal_code: string | null
          preferred_name: string | null
          primary_specialty: string | null
          profession: string | null
          service_offerings: string | null
          services_offered: string | null
          start_date_on_network: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          activation_status?: string | null
          actively_licensed_states?: string | null
          address_city?: never
          address_line_1?: never
          address_line_2?: never
          address_state?: never
          agency_id?: string | null
          avatar_url?: string | null
          bio?: string | null
          birthday?: never
          created_at?: string | null
          credentials?: string | null
          date_of_birth?: never
          email?: string | null
          emergency_contact_name?: never
          emergency_contact_phone?: never
          employment_status?: string | null
          employment_type?: string | null
          first_name?: string | null
          full_name?: string | null
          home_address?: never
          id?: string | null
          languages?: string | null
          last_name?: string | null
          manages_own_renewals?: boolean | null
          min_patient_age?: string | null
          npi_number?: string | null
          onboarding_completed?: boolean | null
          patient_age_preference?: string | null
          personal_email?: never
          phone_number?: string | null
          pod_id?: string | null
          postal_code?: never
          preferred_name?: string | null
          primary_specialty?: string | null
          profession?: string | null
          service_offerings?: string | null
          services_offered?: string | null
          start_date_on_network?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          activation_status?: string | null
          actively_licensed_states?: string | null
          address_city?: never
          address_line_1?: never
          address_line_2?: never
          address_state?: never
          agency_id?: string | null
          avatar_url?: string | null
          bio?: string | null
          birthday?: never
          created_at?: string | null
          credentials?: string | null
          date_of_birth?: never
          email?: string | null
          emergency_contact_name?: never
          emergency_contact_phone?: never
          employment_status?: string | null
          employment_type?: string | null
          first_name?: string | null
          full_name?: string | null
          home_address?: never
          id?: string | null
          languages?: string | null
          last_name?: string | null
          manages_own_renewals?: boolean | null
          min_patient_age?: string | null
          npi_number?: string | null
          onboarding_completed?: boolean | null
          patient_age_preference?: string | null
          personal_email?: never
          phone_number?: string | null
          pod_id?: string | null
          postal_code?: never
          preferred_name?: string | null
          primary_specialty?: string | null
          profession?: string | null
          service_offerings?: string | null
          services_offered?: string | null
          start_date_on_network?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_pod_id_fkey"
            columns: ["pod_id"]
            isOneToOne: false
            referencedRelation: "pods"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      agreement_task_category:
        | "agreement_creation"
        | "signature"
        | "supervision_meeting"
        | "chart_review"
        | "renewal"
        | "termination"
        | "compliance"
        | "document"
        | "custom"
        | "all_hands_attestation"
      agreement_task_status:
        | "pending"
        | "in_progress"
        | "completed"
        | "blocked"
        | "cancelled"
        | "waiting_on_signature"
      agreement_workflow_status:
        | "draft"
        | "pending_signatures"
        | "awaiting_physician_signature"
        | "awaiting_provider_signatures"
        | "fully_executed"
        | "active"
        | "pending_renewal"
        | "termination_initiated"
        | "terminated"
      app_role: "admin" | "provider" | "physician" | "leadership"
      attestation_status: "pending" | "completed" | "overdue" | "excused"
      collab_requirement_type: "never" | "always" | "conditional"
      ehr_activation_status:
        | "inactive"
        | "activation_requested"
        | "active"
        | "deactivation_requested"
        | "deactivated"
      mismatch_type:
        | "active_but_not_ready"
        | "ready_but_inactive"
        | "expired_license_but_active"
        | "expired_collab_but_active"
        | "none"
      notification_type:
        | "agreement_initiated"
        | "signature_requested"
        | "signature_reminder"
        | "agreement_executed"
        | "meeting_scheduled"
        | "termination_initiated"
        | "termination_complete"
      readiness_status: "not_ready" | "ready" | "at_risk" | "blocked"
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
      agreement_task_category: [
        "agreement_creation",
        "signature",
        "supervision_meeting",
        "chart_review",
        "renewal",
        "termination",
        "compliance",
        "document",
        "custom",
        "all_hands_attestation",
      ],
      agreement_task_status: [
        "pending",
        "in_progress",
        "completed",
        "blocked",
        "cancelled",
        "waiting_on_signature",
      ],
      agreement_workflow_status: [
        "draft",
        "pending_signatures",
        "awaiting_physician_signature",
        "awaiting_provider_signatures",
        "fully_executed",
        "active",
        "pending_renewal",
        "termination_initiated",
        "terminated",
      ],
      app_role: ["admin", "provider", "physician", "leadership"],
      attestation_status: ["pending", "completed", "overdue", "excused"],
      collab_requirement_type: ["never", "always", "conditional"],
      ehr_activation_status: [
        "inactive",
        "activation_requested",
        "active",
        "deactivation_requested",
        "deactivated",
      ],
      mismatch_type: [
        "active_but_not_ready",
        "ready_but_inactive",
        "expired_license_but_active",
        "expired_collab_but_active",
        "none",
      ],
      notification_type: [
        "agreement_initiated",
        "signature_requested",
        "signature_reminder",
        "agreement_executed",
        "meeting_scheduled",
        "termination_initiated",
        "termination_complete",
      ],
      readiness_status: ["not_ready", "ready", "at_risk", "blocked"],
    },
  },
} as const

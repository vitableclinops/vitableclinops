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
            referencedRelation: "collaborative_agreements"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "collaborative_agreements"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborative_agreements: {
        Row: {
          agreement_document_url: string | null
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
          physician_email: string
          physician_id: string | null
          physician_name: string
          physician_npi: string | null
          physician_signed_at: string | null
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
          agreement_document_url?: string | null
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
          physician_email: string
          physician_id?: string | null
          physician_name: string
          physician_npi?: string | null
          physician_signed_at?: string | null
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
          agreement_document_url?: string | null
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
          physician_email?: string
          physician_id?: string | null
          physician_name?: string
          physician_npi?: string | null
          physician_signed_at?: string | null
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
      profiles: {
        Row: {
          actively_licensed_states: string | null
          address_city: string | null
          address_line_1: string | null
          address_line_2: string | null
          address_state: string | null
          auto_renew_licenses: boolean | null
          avatar_url: string | null
          birthday: string | null
          board_certificates: string | null
          caqh_number: string | null
          chart_review_folder_url: string | null
          collaborative_physician: string | null
          created_at: string
          credentials: string | null
          email: string
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          employment_end_date: string | null
          employment_offer_date: string | null
          employment_start_date: string | null
          employment_status: string | null
          first_name: string | null
          full_name: string | null
          has_caqh_management: boolean | null
          has_collaborative_agreements: boolean | null
          home_address: string | null
          id: string
          languages: string | null
          last_name: string | null
          medallion_id: string | null
          middle_name: string | null
          min_patient_age: string | null
          notes: string | null
          npi_number: string | null
          patient_age_preference: string | null
          personal_email: string | null
          phone_number: string | null
          postal_code: string | null
          practice_restrictions: string | null
          preferred_name: string | null
          primary_specialty: string | null
          profession: string | null
          pronoun: string | null
          secondary_contact_email: string | null
          service_offerings: string | null
          services_offered: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          actively_licensed_states?: string | null
          address_city?: string | null
          address_line_1?: string | null
          address_line_2?: string | null
          address_state?: string | null
          auto_renew_licenses?: boolean | null
          avatar_url?: string | null
          birthday?: string | null
          board_certificates?: string | null
          caqh_number?: string | null
          chart_review_folder_url?: string | null
          collaborative_physician?: string | null
          created_at?: string
          credentials?: string | null
          email: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employment_end_date?: string | null
          employment_offer_date?: string | null
          employment_start_date?: string | null
          employment_status?: string | null
          first_name?: string | null
          full_name?: string | null
          has_caqh_management?: boolean | null
          has_collaborative_agreements?: boolean | null
          home_address?: string | null
          id?: string
          languages?: string | null
          last_name?: string | null
          medallion_id?: string | null
          middle_name?: string | null
          min_patient_age?: string | null
          notes?: string | null
          npi_number?: string | null
          patient_age_preference?: string | null
          personal_email?: string | null
          phone_number?: string | null
          postal_code?: string | null
          practice_restrictions?: string | null
          preferred_name?: string | null
          primary_specialty?: string | null
          profession?: string | null
          pronoun?: string | null
          secondary_contact_email?: string | null
          service_offerings?: string | null
          services_offered?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          actively_licensed_states?: string | null
          address_city?: string | null
          address_line_1?: string | null
          address_line_2?: string | null
          address_state?: string | null
          auto_renew_licenses?: boolean | null
          avatar_url?: string | null
          birthday?: string | null
          board_certificates?: string | null
          caqh_number?: string | null
          chart_review_folder_url?: string | null
          collaborative_physician?: string | null
          created_at?: string
          credentials?: string | null
          email?: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employment_end_date?: string | null
          employment_offer_date?: string | null
          employment_start_date?: string | null
          employment_status?: string | null
          first_name?: string | null
          full_name?: string | null
          has_caqh_management?: boolean | null
          has_collaborative_agreements?: boolean | null
          home_address?: string | null
          id?: string
          languages?: string | null
          last_name?: string | null
          medallion_id?: string | null
          middle_name?: string | null
          min_patient_age?: string | null
          notes?: string | null
          npi_number?: string | null
          patient_age_preference?: string | null
          personal_email?: string | null
          phone_number?: string | null
          postal_code?: string | null
          practice_restrictions?: string | null
          preferred_name?: string | null
          primary_specialty?: string | null
          profession?: string | null
          pronoun?: string | null
          secondary_contact_email?: string | null
          service_offerings?: string | null
          services_offered?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
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
      state_compliance_requirements: {
        Row: {
          ca_meeting_cadence: string | null
          ca_required: boolean | null
          created_at: string | null
          fpa_status: string | null
          id: string
          knowledge_base_url: string | null
          licenses: string | null
          meeting_months: number[] | null
          nlc: boolean | null
          np_md_ratio: string | null
          rxr_required: boolean | null
          state_abbreviation: string
          state_name: string
          steps_to_confirm_eligibility: string | null
          updated_at: string | null
        }
        Insert: {
          ca_meeting_cadence?: string | null
          ca_required?: boolean | null
          created_at?: string | null
          fpa_status?: string | null
          id?: string
          knowledge_base_url?: string | null
          licenses?: string | null
          meeting_months?: number[] | null
          nlc?: boolean | null
          np_md_ratio?: string | null
          rxr_required?: boolean | null
          state_abbreviation: string
          state_name: string
          steps_to_confirm_eligibility?: string | null
          updated_at?: string | null
        }
        Update: {
          ca_meeting_cadence?: string | null
          ca_required?: boolean | null
          created_at?: string | null
          fpa_status?: string | null
          id?: string
          knowledge_base_url?: string | null
          licenses?: string | null
          meeting_months?: number[] | null
          nlc?: boolean | null
          np_md_ratio?: string | null
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
            referencedRelation: "collaborative_agreements"
            referencedColumns: ["id"]
          },
        ]
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
    }
    Views: {
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
      provider_directory_public: {
        Row: {
          avatar_url: string | null
          credentials: string | null
          employment_status: string | null
          full_name: string | null
          home_state: string | null
          id: string | null
          npi_number: string | null
          preferred_name: string | null
          primary_specialty: string | null
          profession: string | null
          states: string | null
        }
        Insert: {
          avatar_url?: string | null
          credentials?: string | null
          employment_status?: string | null
          full_name?: string | null
          home_state?: string | null
          id?: string | null
          npi_number?: string | null
          preferred_name?: string | null
          primary_specialty?: string | null
          profession?: string | null
          states?: string | null
        }
        Update: {
          avatar_url?: string | null
          credentials?: string | null
          employment_status?: string | null
          full_name?: string | null
          home_state?: string | null
          id?: string | null
          npi_number?: string | null
          preferred_name?: string | null
          primary_specialty?: string | null
          profession?: string | null
          states?: string | null
        }
        Relationships: []
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
      notification_type:
        | "agreement_initiated"
        | "signature_requested"
        | "signature_reminder"
        | "agreement_executed"
        | "meeting_scheduled"
        | "termination_initiated"
        | "termination_complete"
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
      notification_type: [
        "agreement_initiated",
        "signature_requested",
        "signature_reminder",
        "agreement_executed",
        "meeting_scheduled",
        "termination_initiated",
        "termination_complete",
      ],
    },
  },
} as const

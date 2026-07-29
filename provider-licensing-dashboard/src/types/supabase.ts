export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type LicenseType = 'RN' | 'NP';
export type EffectiveStatus = 'active_direct' | 'active_via_compact' | 'in_progress' | 'needed';
export type TaskStatus = 'not_started' | 'in_progress' | 'complete' | 'blocked';

export type Database = {
  public: {
    Tables: {
      providers: {
        Row: {
          id: string;
          name: string;
          home_state: string | null;
          medallion_provider_id: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          home_state?: string | null;
          medallion_provider_id?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          home_state?: string | null;
          medallion_provider_id?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'providers_home_state_fkey';
            columns: ['home_state'];
            isOneToOne: false;
            referencedRelation: 'states';
            referencedColumns: ['code'];
          },
        ];
      };
      license_tasks: {
        Row: {
          id: string;
          provider_id: string;
          state_code: string;
          license_type: LicenseType;
          step_name: string;
          step_order: number;
          status: TaskStatus;
          owner: string | null;
          due_date: string | null;
          completed_at: string | null;
          notes: string | null;
        };
        Insert: {
          id?: string;
          provider_id: string;
          state_code: string;
          license_type: LicenseType;
          step_name: string;
          step_order?: number;
          status?: TaskStatus;
          owner?: string | null;
          due_date?: string | null;
          completed_at?: string | null;
          notes?: string | null;
        };
        Update: {
          id?: string;
          provider_id?: string;
          state_code?: string;
          license_type?: LicenseType;
          step_name?: string;
          step_order?: number;
          status?: TaskStatus;
          owner?: string | null;
          due_date?: string | null;
          completed_at?: string | null;
          notes?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'license_tasks_provider_id_fkey';
            columns: ['provider_id'];
            isOneToOne: false;
            referencedRelation: 'providers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'license_tasks_state_code_fkey';
            columns: ['state_code'];
            isOneToOne: false;
            referencedRelation: 'states';
            referencedColumns: ['code'];
          },
        ];
      };
      provider_licenses: {
        Row: {
          id: string;
          provider_id: string;
          state_code: string;
          license_type: LicenseType;
          status: 'not_started' | 'in_progress' | 'submitted' | 'active' | 'expired';
          license_number: string | null;
          expiration_date: string | null;
          source: 'medallion' | 'independent' | 'legitscript' | 'multistate_compact';
          medallion_license_id: string | null;
          last_synced_at: string | null;
          notes: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'provider_licenses_provider_id_fkey';
            columns: ['provider_id'];
            isOneToOne: false;
            referencedRelation: 'providers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'provider_licenses_state_code_fkey';
            columns: ['state_code'];
            isOneToOne: false;
            referencedRelation: 'states';
            referencedColumns: ['code'];
          },
        ];
      };
      states: {
        Row: {
          code: string;
          name: string;
          is_nurse_compact: boolean;
          is_aprn_compact: boolean;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: {
      provider_effective_licenses: {
        Row: {
          provider_id: string;
          provider_name: string;
          home_state: string | null;
          home_state_name: string | null;
          state_code: string;
          state_name: string;
          license_type: LicenseType;
          effective_status: EffectiveStatus;
          compact_coverage_available: boolean;
          compact_basis: 'nurse_licensure_compact' | 'aprn_compact' | null;
          target_is_nurse_compact: boolean;
          target_is_aprn_compact: boolean;
          home_is_nurse_compact: boolean;
          home_is_aprn_compact: boolean;
          aprn_compact_operational: boolean;
          license_id: string | null;
          direct_status: string | null;
          source: string | null;
          license_number: string | null;
          expiration_date: string | null;
          medallion_license_id: string | null;
          last_synced_at: string | null;
          notes: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'provider_effective_licenses_provider_id_fkey';
            columns: ['provider_id'];
            isOneToOne: false;
            referencedRelation: 'providers';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

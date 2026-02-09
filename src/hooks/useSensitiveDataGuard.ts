import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useProhibitedPatterns } from './useSystemConfig';

const ALWAYS_PROHIBITED = ['SSN', 'social security number', 'bank account', 'routing number', 'tax document', 'W-9', 'W-4', 'I-9'];

export function useSensitiveDataGuard() {
  const configuredPatterns = useProhibitedPatterns();
  const allPatterns = [...new Set([...ALWAYS_PROHIBITED, ...configuredPatterns])];

  const checkForSensitiveData = useCallback((value: string): { isSensitive: boolean; matchedPattern: string | null } => {
    const lower = value.toLowerCase();
    
    // Check SSN pattern (XXX-XX-XXXX)
    if (/\b\d{3}-\d{2}-\d{4}\b/.test(value)) {
      return { isSensitive: true, matchedPattern: 'SSN format detected' };
    }
    
    // Check for bank routing numbers (9 digits)
    if (/\b\d{9}\b/.test(value) && lower.includes('rout')) {
      return { isSensitive: true, matchedPattern: 'Routing number detected' };
    }
    
    // Check against patterns
    for (const pattern of allPatterns) {
      if (lower.includes(pattern.toLowerCase())) {
        return { isSensitive: true, matchedPattern: pattern };
      }
    }
    
    return { isSensitive: false, matchedPattern: null };
  }, [allPatterns]);

  const logSensitiveAccess = useCallback(async (fieldName: string, entityType: string, entityId?: string, detectedPattern?: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('sensitive_data_log').insert({
      user_id: user?.id,
      action: 'sensitive_data_warning',
      field_name: fieldName,
      entity_type: entityType,
      entity_id: entityId,
      detected_pattern: detectedPattern,
    });
  }, []);

  return { checkForSensitiveData, logSensitiveAccess, prohibitedPatterns: allPatterns };
}

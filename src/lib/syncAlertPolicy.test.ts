import { describe, expect, it } from 'vitest';
import { shouldSendSyncAlert } from '../../supabase/functions/alert-sync-failures/alertPolicy';

describe('sync notification mute', () => {
  it('does not send PCP coverage failure alerts', () => {
    expect(shouldSendSyncAlert({ function_name: 'sync-pcp-coverage' })).toBe(false);
  });

  it('keeps other sync failure alerts enabled', () => {
    for (const function_name of ['sync-metabase', 'sync-homebase', 'sync-medallion-directory']) {
      expect(shouldSendSyncAlert({ function_name })).toBe(true);
    }
  });
});
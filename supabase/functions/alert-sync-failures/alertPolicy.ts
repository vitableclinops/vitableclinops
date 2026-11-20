// Notification-only mute: refresh jobs and their error history remain untouched.
export const MUTED_SYNC_FUNCTION = 'sync-pcp-coverage';

export function shouldSendSyncAlert(run: { function_name: string }): boolean {
  return run.function_name !== MUTED_SYNC_FUNCTION;
}
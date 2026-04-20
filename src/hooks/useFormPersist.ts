import { useEffect, useRef } from 'react';

/**
 * Persists serializable form state to sessionStorage so it survives a session
 * expiry + re-login within the same browser tab.
 *
 * Usage:
 *   const { clearSaved, hasSaved } = useFormPersist('agreement-wizard', { formData, step }, restore);
 *
 * - On mount: if a saved snapshot exists, `restore` is called with the parsed value.
 * - On every render: the current `value` is serialized and written to sessionStorage.
 * - Call `clearSaved()` on successful submit or intentional close.
 */
export function useFormPersist<T>(
  key: string,
  value: T,
  restore: (saved: T) => void,
): { clearSaved: () => void; hasSaved: boolean } {
  const storageKey = `form_persist_${key}`;
  const restoredRef = useRef(false);

  // Restore once on mount
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return;
    try {
      restore(JSON.parse(raw) as T);
    } catch {
      sessionStorage.removeItem(storageKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save on every value change
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // sessionStorage may be full or unavailable (private browsing)
    }
  }, [storageKey, value]);

  return {
    clearSaved: () => sessionStorage.removeItem(storageKey),
    hasSaved: typeof window !== 'undefined' && !!sessionStorage.getItem(storageKey),
  };
}

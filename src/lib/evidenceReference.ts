/** Resolve only this application's storage URLs; external URLs remain external. */
export function evidenceReference(reference: string, defaultBucket = 'task-documents', storageOrigin = import.meta.env.VITE_SUPABASE_URL): { bucket: string; path: string } | { url: string } {
  const value = reference.trim();
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    const match = url.pathname.match(/^\/storage\/v1\/object\/(?:sign|public|authenticated)\/([^/]+)\/(.+)$/);
    if (storageOrigin && url.origin === new URL(storageOrigin).origin && match) {
      return { bucket: decodeURIComponent(match[1]), path: decodeURIComponent(match[2]) };
    }
    return { url: value };
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//') || !value) throw new Error('Invalid attachment reference');
  return { bucket: defaultBucket, path: value };
}
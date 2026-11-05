// Directory display format for every provider: "First (Preferred) Last" when a
// preferred name differs from the first name, otherwise the full legal name.
// Canonical profile names are never changed.
export function directoryDisplayName(provider: { id: string; full_name: string | null; preferred_name: string | null }) {
  const full = (provider.full_name || '').trim();
  const preferred = (provider.preferred_name || '').trim();
  if (!full) return preferred || 'Unknown';
  if (!preferred) return full;
  const parts = full.split(/\s+/);
  if (parts.length < 2) return `${full} (${preferred})`;
  const first = parts[0];
  if (first.toLowerCase() === preferred.toLowerCase() || full.toLowerCase() === preferred.toLowerCase()) return full;
  return `${first} (${preferred}) ${parts.slice(1).join(' ')}`;
}

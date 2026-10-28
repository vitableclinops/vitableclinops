/** Directory-only display; never changes canonical legal identity. */
export function directoryDisplayName(provider: { id: string; full_name: string | null; preferred_name: string | null }) {
  if (provider.id === 'c69f6935-34eb-4ba2-b4c0-794d95370027' && provider.full_name === 'Amanda Clement' && provider.preferred_name === 'Mandy') {
    return 'Amanda (Mandy) Clement';
  }
  return provider.preferred_name || provider.full_name || 'Unknown';
}
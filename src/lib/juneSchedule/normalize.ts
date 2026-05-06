export function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,]/g, '');
}

export function normEmail(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  return t || null;
}

export function providerKey(name: string, email: string | null): string {
  const e = normEmail(email);
  return e ?? normName(name);
}
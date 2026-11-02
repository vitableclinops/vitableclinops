import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import Index from '@/pages/Index';

/**
 * Remembers the last page the user was on (route + query params, e.g. the
 * ?state= filter on Agreements) in sessionStorage and restores it when the
 * preview reloads — which happens when a user switches browser tabs and
 * comes back and the app boots again at the root URL.
 *
 * Restores only when the app initially lands on "/" so deliberate deep
 * links, bookmarks and sign-in redirects are never hijacked.
 */

const STORAGE_KEY = 'lovable_last_route';

const SKIP_PREFIXES = ['/auth', '/task/'];

function isRestorable(path: string) {
  return !!path && !SKIP_PREFIXES.some(p => path === p || path.startsWith(`${p}/`));
}

function readSaved(): string | null {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    return saved && saved !== '/' && isRestorable(saved) ? saved : null;
  } catch {
    return null;
  }
}

/** Root route: bounce to the last page viewed if one was remembered. */
export function RestoreLastRoute() {
  const saved = readSaved();
  if (saved) return <Navigate to={saved} replace />;
  return <Index />;
}

/** Tracks every navigation and remembers it. */
export function RouteMemory() {
  const location = useLocation();

  useEffect(() => {
    const full = `${location.pathname}${location.search}`;
    // Never remember the bare root: the app boots there on a reload and the
    // role redirect immediately records the real destination (/admin, etc.).
    if (full === '/' || full === '') return;
    if (!isRestorable(full)) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, full);
    } catch {
      // sessionStorage unavailable (private browsing) — ignore
    }
  }, [location.pathname, location.search]);

  return null;
}

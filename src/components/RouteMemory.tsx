import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

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

export function RouteMemory() {
  const location = useLocation();
  const navigate = useNavigate();
  const isInitial = useRef(true);

  useEffect(() => {
    const full = `${location.pathname}${location.search}`;

    if (isInitial.current) {
      isInitial.current = false;
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (
        saved &&
        saved !== '/' &&
        isRestorable(saved) &&
        (location.pathname === '/' || location.pathname === '')
      ) {
        navigate(saved, { replace: true });
      }
      return;
    }

    if (isRestorable(full)) {
      try {
        sessionStorage.setItem(STORAGE_KEY, full);
      } catch {
        // sessionStorage unavailable (private browsing) — ignore
      }
    }
  }, [location.pathname, location.search, navigate]);

  return null;
}

import { useCallback, useEffect, useState } from 'react';

// Lightweight per-browser persistence of "Posted to Homebase / EHR" flags
// for the June MVP page. Keyed by target month + provider key (string from
// uploaded data, not a clinops UUID). Persists to localStorage so a refresh
// doesn't lose state, but no server round-trip is required.

export interface PublishFlags {
  homebaseAt: string | null;
  ehrAt: string | null;
}

const STORE_KEY = 'june-mvp-publish-v1';

type Store = Record<string /* month */, Record<string /* providerKey */, PublishFlags>>;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Store;
  } catch {
    return {};
  }
}

function writeStore(s: Store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota */
  }
}

export function useJunePublishLocal(month: string) {
  const [tick, setTick] = useState(0);
  const [snapshot, setSnapshot] = useState<Record<string, PublishFlags>>({});

  useEffect(() => {
    const s = readStore();
    setSnapshot(s[month] ?? {});
  }, [month, tick]);

  const get = useCallback(
    (providerKey: string): PublishFlags => snapshot[providerKey] ?? { homebaseAt: null, ehrAt: null },
    [snapshot],
  );

  const set = useCallback(
    (providerKey: string, step: 'homebase' | 'ehr', done: boolean) => {
      const store = readStore();
      const monthMap = { ...(store[month] ?? {}) };
      const cur = monthMap[providerKey] ?? { homebaseAt: null, ehrAt: null };
      const nowIso = new Date().toISOString();
      const next: PublishFlags = {
        homebaseAt: step === 'homebase' ? (done ? nowIso : null) : cur.homebaseAt,
        ehrAt: step === 'ehr' ? (done ? nowIso : null) : cur.ehrAt,
      };
      monthMap[providerKey] = next;
      store[month] = monthMap;
      writeStore(store);
      setTick(t => t + 1);
    },
    [month],
  );

  const setMany = useCallback(
    (providerKeys: string[], step: 'homebase' | 'ehr', done: boolean) => {
      const store = readStore();
      const monthMap = { ...(store[month] ?? {}) };
      const nowIso = new Date().toISOString();
      for (const k of providerKeys) {
        const cur = monthMap[k] ?? { homebaseAt: null, ehrAt: null };
        monthMap[k] = {
          homebaseAt: step === 'homebase' ? (done ? nowIso : null) : cur.homebaseAt,
          ehrAt: step === 'ehr' ? (done ? nowIso : null) : cur.ehrAt,
        };
      }
      store[month] = monthMap;
      writeStore(store);
      setTick(t => t + 1);
    },
    [month],
  );

  return { get, set, setMany, snapshot };
}
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isReferenceDataLoaded, loadReferenceData, resetReferenceData } from '../data/referenceData';
import { useAuth } from './AuthContext';

/**
 * Loads the shared reference-data caches (partners, projects, form lookups) once the admin
 * is signed in, and re-renders the tree when they land.
 *
 * The screens themselves keep reading the caches through the synchronous helpers in
 * `src/data/referenceData.ts`; this provider exists only to make sure those helpers have
 * something in them by the time a screen renders, and to clear them on sign-out.
 */

interface ReferenceDataValue {
  ready: boolean;
  error?: string;
  reload: () => Promise<void>;
}

const ReferenceDataContext = createContext<ReferenceDataValue>({ ready: false, reload: async () => {} });

export function ReferenceDataProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [ready, setReady] = useState(isReferenceDataLoaded());
  const [error, setError] = useState<string>();

  const load = useCallback(async (force = false) => {
    try {
      setError(undefined);
      await loadReferenceData(force);
      setReady(true);
    } catch (err) {
      // A failure here is not fatal: every screen still fetches its own rows, they just
      // show a dash where a resolved name would be. Surfacing it lets the UI offer a retry.
      setError(err instanceof Error ? err.message : 'Could not load reference data.');
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!session) {
      resetReferenceData();
      setReady(false);
      return;
    }
    void load();
  }, [session, load]);

  const value = useMemo<ReferenceDataValue>(
    () => ({ ready, error, reload: () => load(true) }),
    [ready, error, load]
  );

  return <ReferenceDataContext.Provider value={value}>{children}</ReferenceDataContext.Provider>;
}

export function useReferenceData(): ReferenceDataValue {
  return useContext(ReferenceDataContext);
}

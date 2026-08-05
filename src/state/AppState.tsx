import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, jsonBody } from '../api';
import type { Bootstrap, Settings } from '../types';

type AppStateValue = {
  data: Bootstrap | null; loading: boolean; error: string; notice: string;
  refresh: () => Promise<void>; updateSettings: (values: Partial<Settings>) => Promise<void>;
  notify: (message: string) => void;
};

const AppStateContext = createContext<AppStateValue | null>(null);

function legacyPayload() {
  const read = (key: string, fallback: unknown) => { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; } catch { return fallback; } };
  return {
    courses: read('echoline-courses', []), vocabulary: read('echoline-vocabulary', []), stats: read('echoline-study-stats', {}),
    settings: { darkMode: read('echoline-dark-mode', false), videoHidden: read('echoline-video-hidden', false), selectedCourseId: read('echoline-selected-course', 'ai-prompting') },
  };
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const notify = useCallback((message: string) => {
    setNotice(message); window.setTimeout(() => setNotice((current) => current === message ? '' : current), 2600);
  }, []);

  const refresh = useCallback(async () => {
    const next = await api<Bootstrap>('/api/bootstrap');
    setData(next); setError('');
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        let next = await api<Bootstrap>('/api/bootstrap', { signal: controller.signal });
        if (!next.settings.localStorageMigrated) {
          await api('/api/migrate/local-storage', { method: 'POST', ...jsonBody(legacyPayload()), signal: controller.signal });
          next = await api<Bootstrap>('/api/bootstrap', { signal: controller.signal });
        }
        setData(next);
      } catch (reason) { if ((reason as Error).name !== 'AbortError') setError((reason as Error).message); }
      finally { setLoading(false); }
    })();
    return () => controller.abort();
  }, []);

  const updateSettings = useCallback(async (values: Partial<Settings>) => {
    setData((current) => current ? { ...current, settings: { ...current.settings, ...values } } : current);
    try { await api('/api/settings', { method: 'PATCH', ...jsonBody(values) }); }
    catch (reason) { await refresh(); throw reason; }
  }, [refresh]);

  useEffect(() => { document.documentElement.style.colorScheme = data?.settings.darkMode ? 'dark' : 'light'; }, [data?.settings.darkMode]);
  const value = useMemo(() => ({ data, loading, error, notice, refresh, updateSettings, notify }), [data, loading, error, notice, refresh, updateSettings, notify]);
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const value = useContext(AppStateContext);
  if (!value) throw new Error('useAppState 必须在 AppStateProvider 内使用');
  return value;
}

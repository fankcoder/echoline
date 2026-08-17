import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, jsonBody } from '../api';
import { clearLocalVocabulary, readLocalVocabulary, removeLocalPhrase, reviewLocalVocabulary, saveLocalPhrase, toggleLocalWord, writeLocalVocabulary } from '../localVocabulary';
import { clearLocalFavoriteExamples, readLocalFavoriteExamples, removeLocalFavoriteExample, saveLocalFavoriteExample, writeLocalFavoriteExamples, type FavoriteExampleValue } from '../localFavoriteExamples';
import type { Bootstrap, FavoriteExample, Settings, VocabularyItem } from '../types';

type PhraseValue = { text: string; meaning: string; note: string; example: string; lessonId: string | null; cueId: string | null };

type AppStateValue = {
  data: Bootstrap | null; loading: boolean; error: string; notice: string;
  refresh: () => Promise<void>; updateSettings: (values: Partial<Settings>) => Promise<void>;
  toggleVocabulary: (word: string, lessonId?: string | null, cueId?: string | null) => Promise<void>;
  savePhrase: (value: PhraseValue, existingWord?: string) => Promise<void>;
  removePhrase: (word: string) => Promise<void>;
  saveFavoriteExample: (value: FavoriteExampleValue, courseId?: string) => Promise<void>;
  removeFavoriteExample: (id: string) => Promise<void>;
  recordReview: (group: number, items: Array<{ word: string; kind: string }>) => Promise<void>;
  logout: () => Promise<void>;
  notify: (message: string) => void;
};

const AppStateContext = createContext<AppStateValue | null>(null);

function legacyPayload() {
  const read = (key: string, fallback: unknown) => { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; } catch { return fallback; } };
  return {
    courses: read('echoline-courses', []), vocabulary: [], stats: read('echoline-study-stats', {}),
    settings: { darkMode: read('echoline-dark-mode', false), videoHidden: read('echoline-video-hidden', false), repeatCount: 1, selectedCourseId: read('echoline-selected-course', 'ai-prompting') },
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

  const applyVocabulary = useCallback((vocabulary: VocabularyItem[]) => {
    setData((current) => {
      if (!current) return current;
      if (!current.user) writeLocalVocabulary(vocabulary);
      return { ...current, vocabulary };
    });
  }, []);

  const applyFavoriteExamples = useCallback((favoriteExamples: FavoriteExample[]) => {
    setData((current) => {
      if (!current) return current;
      if (!current.user) writeLocalFavoriteExamples(favoriteExamples);
      return { ...current, favoriteExamples };
    });
  }, []);

  const loadBootstrap = useCallback(async (signal?: AbortSignal) => {
    const next = await api<Bootstrap>('/api/bootstrap', { signal });
    if (!next.user) return { ...next, vocabulary: readLocalVocabulary(), favoriteExamples: readLocalFavoriteExamples() };
    const localVocabulary = readLocalVocabulary();
    const localFavoriteExamples = readLocalFavoriteExamples();
    if (!localVocabulary.length && !localFavoriteExamples.length) return next;
    const [vocabulary, favoriteExamples] = await Promise.all([
      localVocabulary.length
        ? api<{ vocabulary: VocabularyItem[] }>('/api/vocabulary/sync', { method: 'POST', signal, ...jsonBody({ items: localVocabulary }) })
        : Promise.resolve({ vocabulary: next.vocabulary }),
      localFavoriteExamples.length
        ? api<{ favoriteExamples: FavoriteExample[] }>('/api/favorite-examples/sync', { method: 'POST', signal, ...jsonBody({ items: localFavoriteExamples }) })
        : Promise.resolve({ favoriteExamples: next.favoriteExamples }),
    ]);
    if (localVocabulary.length) clearLocalVocabulary();
    if (localFavoriteExamples.length) clearLocalFavoriteExamples();
    return { ...next, vocabulary: vocabulary.vocabulary, favoriteExamples: favoriteExamples.favoriteExamples };
  }, []);

  const refresh = useCallback(async () => { setData(await loadBootstrap()); setError(''); }, [loadBootstrap]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        let next = await loadBootstrap(controller.signal);
        if (!next.settings.localStorageMigrated) {
          await api('/api/migrate/local-storage', { method: 'POST', ...jsonBody(legacyPayload()), signal: controller.signal });
          next = await loadBootstrap();
        }
        setData(next);
      } catch (reason) { if ((reason as Error).name !== 'AbortError') setError((reason as Error).message); }
      finally { setLoading(false); }
    })();
    return () => controller.abort();
  }, [loadBootstrap]);

  const updateSettings = useCallback(async (values: Partial<Settings>) => {
    setData((current) => current ? { ...current, settings: { ...current.settings, ...values } } : current);
    try { await api('/api/settings', { method: 'PATCH', ...jsonBody(values) }); }
    catch (reason) { await refresh(); throw reason; }
  }, [refresh]);

  const toggleVocabulary = useCallback(async (word: string, lessonId: string | null = null, cueId: string | null = null) => {
    if (data?.user) {
      const result = await api<{ vocabulary: VocabularyItem[] }>('/api/vocabulary/toggle', { method: 'POST', ...jsonBody({ word, lessonId, cueId }) });
      applyVocabulary(result.vocabulary);
      return;
    }
    applyVocabulary(toggleLocalWord(data?.vocabulary || [], word, lessonId, cueId));
  }, [applyVocabulary, data?.user, data?.vocabulary]);

  const savePhrase = useCallback(async (value: PhraseValue, existingWord?: string) => {
    if (data?.user) {
      const result = await api<{ vocabulary: VocabularyItem[] }>(existingWord ? `/api/phrases/${encodeURIComponent(existingWord)}` : '/api/phrases', { method: existingWord ? 'PATCH' : 'POST', ...jsonBody({ phrase: value.text, meaning: value.meaning, note: value.note, example: value.example, lessonId: value.lessonId, cueId: value.cueId }) });
      applyVocabulary(result.vocabulary);
      return;
    }
    applyVocabulary(saveLocalPhrase(data?.vocabulary || [], value, existingWord));
  }, [applyVocabulary, data?.user, data?.vocabulary]);

  const removePhrase = useCallback(async (word: string) => {
    if (data?.user) {
      const result = await api<{ vocabulary: VocabularyItem[] }>(`/api/phrases/${encodeURIComponent(word)}`, { method: 'DELETE' });
      applyVocabulary(result.vocabulary);
      return;
    }
    applyVocabulary(removeLocalPhrase(data?.vocabulary || [], word));
  }, [applyVocabulary, data?.user, data?.vocabulary]);

  const saveFavoriteExample = useCallback(async (value: FavoriteExampleValue, courseId?: string) => {
    if (data?.user) {
      const result = await api<{ favoriteExamples: FavoriteExample[] }>('/api/favorite-examples', { method: 'POST', ...jsonBody({ lessonId: value.lessonId, cueId: value.cueId, courseId }) });
      applyFavoriteExamples(result.favoriteExamples);
      return;
    }
    applyFavoriteExamples(saveLocalFavoriteExample(data?.favoriteExamples || [], value));
  }, [applyFavoriteExamples, data?.favoriteExamples, data?.user]);

  const removeFavoriteExample = useCallback(async (id: string) => {
    if (data?.user) {
      const result = await api<{ favoriteExamples: FavoriteExample[] }>(`/api/favorite-examples/${encodeURIComponent(id)}`, { method: 'DELETE' });
      applyFavoriteExamples(result.favoriteExamples);
      return;
    }
    applyFavoriteExamples(removeLocalFavoriteExample(data?.favoriteExamples || [], id));
  }, [applyFavoriteExamples, data?.favoriteExamples, data?.user]);

  const recordReview = useCallback(async (group: number, items: Array<{ word: string; kind: string }>) => {
    if (data?.user) {
      const result = await api<{ vocabulary: VocabularyItem[] }>(`/api/review/${group}`, { method: 'POST', ...jsonBody({ items }) });
      applyVocabulary(result.vocabulary);
      return;
    }
    applyVocabulary(reviewLocalVocabulary(data?.vocabulary || [], items.map((item) => item.word)));
  }, [applyVocabulary, data?.user, data?.vocabulary]);

  const logout = useCallback(async () => { await api('/api/auth/logout', { method: 'POST' }); await refresh(); }, [refresh]);

  useEffect(() => { document.documentElement.style.colorScheme = data?.settings.darkMode ? 'dark' : 'light'; }, [data?.settings.darkMode]);
  const value = useMemo(() => ({ data, loading, error, notice, refresh, updateSettings, toggleVocabulary, savePhrase, removePhrase, saveFavoriteExample, removeFavoriteExample, recordReview, logout, notify }), [data, loading, error, notice, refresh, updateSettings, toggleVocabulary, savePhrase, removePhrase, saveFavoriteExample, removeFavoriteExample, recordReview, logout, notify]);
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const value = useContext(AppStateContext);
  if (!value) throw new Error('useAppState 必须在 AppStateProvider 内使用');
  return value;
}

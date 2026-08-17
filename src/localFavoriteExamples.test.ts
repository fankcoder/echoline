import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLocalFavoriteExamples, removeLocalFavoriteExample, saveLocalFavoriteExample } from './localFavoriteExamples';

function installStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('local favorite examples', () => {
  it('deduplicates a saved sentence and persists removal', () => {
    installStorage();
    const value = { lessonId: '1dc199c5-0de3-4559-a20f-02b9b05af58c', cueId: 'cue-1', sentence: 'A useful sentence.', translation: '一句有用的话。', courseName: 'Test', lessonTitle: 'Lesson', sourceUrl: 'https://example.com/lesson', startSeconds: 4 };
    const saved = saveLocalFavoriteExample([], value);
    expect(saved).toHaveLength(1);
    expect(saveLocalFavoriteExample(saved, value)).toHaveLength(1);
    expect(readLocalFavoriteExamples()).toMatchObject([{ sentence: 'A useful sentence.', translation: '一句有用的话。' }]);
    expect(removeLocalFavoriteExample(saved, saved[0].id)).toEqual([]);
    expect(readLocalFavoriteExamples()).toEqual([]);
  });
});

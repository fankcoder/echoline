import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLocalVocabulary, reviewLocalVocabulary } from './localVocabulary';
import type { VocabularyItem } from './types';

function installStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
}

function item(word: string, addedAt: number): VocabularyItem {
  return { word, text: word, kind: 'word', meaning: '', note: '', example: '', lessonId: null, cueId: null, addedAt, reviewCount: 0, lastReviewedAt: null, groupIndex: 0 };
}

afterEach(() => vi.unstubAllGlobals());

describe('local vocabulary review', () => {
  it('increments only a complete selected group and persists the result', () => {
    installStorage();
    vi.spyOn(Date, 'now').mockReturnValue(1_725_000_000_000);
    const vocabulary = Array.from({ length: 11 }, (_, index) => item(`word-${index}`, index));

    expect(() => reviewLocalVocabulary(vocabulary, 0, ['word-0'])).toThrow('复习组内容已变化');

    const reviewed = reviewLocalVocabulary(vocabulary, 0, Array.from({ length: 10 }, (_, index) => `word-${index}`).reverse());
    expect(reviewed.slice(0, 10)).toEqual(expect.arrayContaining([
      expect.objectContaining({ word: 'word-0', reviewCount: 1, lastReviewedAt: 1_725_000_000_000 }),
      expect.objectContaining({ word: 'word-9', reviewCount: 1 }),
    ]));
    expect(reviewed[10]).toMatchObject({ word: 'word-10', reviewCount: 0, lastReviewedAt: null });
    expect(readLocalVocabulary()).toEqual(reviewed);
  });
});

import type { VocabularyItem } from './types';

const STORAGE_KEY = 'echoline-local-vocabulary-v1';

function normalize(value: string) { return value.toLowerCase().replace(/\s+/g, ' ').trim(); }

function withGroups(items: VocabularyItem[]) {
  return [...items].sort((left, right) => left.addedAt - right.addedAt || left.word.localeCompare(right.word)).map((item, index) => ({ ...item, groupIndex: Math.floor(index / 10) }));
}

function validItem(value: unknown): value is VocabularyItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<VocabularyItem>;
  return typeof item.word === 'string' && typeof item.text === 'string' && (item.kind === 'word' || item.kind === 'phrase');
}

function legacyWords() {
  try {
    const value = JSON.parse(localStorage.getItem('echoline-vocabulary') || '[]');
    return Array.isArray(value) ? value.filter((word): word is string => typeof word === 'string').map((word, index) => wordItem(word, null, null, Date.now() + index)) : [];
  } catch { return []; }
}

function wordItem(word: string, lessonId: string | null, cueId: string | null, addedAt = Date.now()): VocabularyItem {
  const normalized = normalize(word);
  return { word: normalized, text: normalized, kind: 'word', meaning: '', note: '', example: '', lessonId, cueId, addedAt, reviewCount: 0, lastReviewedAt: null, groupIndex: 0 };
}

export function readLocalVocabulary() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (Array.isArray(value)) return withGroups(value.filter(validItem).map((item) => ({ ...item, word: normalize(item.word), text: item.text.trim() || item.word, meaning: item.meaning || '', note: item.note || '', example: item.example || '', lessonId: item.lessonId || null, cueId: item.cueId || null, addedAt: Number.isFinite(item.addedAt) ? item.addedAt : Date.now(), reviewCount: Math.max(0, Number(item.reviewCount) || 0), lastReviewedAt: item.lastReviewedAt || null })));
  } catch { return legacyWords(); }
  const migrated = legacyWords();
  if (migrated.length) writeLocalVocabulary(migrated);
  return migrated;
}

export function writeLocalVocabulary(items: VocabularyItem[]) {
  const normalized = withGroups(items);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function clearLocalVocabulary() { localStorage.removeItem(STORAGE_KEY); }

export function toggleLocalWord(items: VocabularyItem[], word: string, lessonId: string | null, cueId: string | null) {
  const normalized = normalize(word); const index = items.findIndex((item) => item.word === normalized);
  if (index >= 0) return writeLocalVocabulary(items.filter((item) => item.word !== normalized));
  return writeLocalVocabulary([...items, wordItem(word, lessonId, cueId)]);
}

export function saveLocalPhrase(items: VocabularyItem[], value: { text: string; meaning: string; note: string; example: string; lessonId: string | null; cueId: string | null }, existingWord?: string) {
  const text = value.text.replace(/\s+/g, ' ').trim(); const word = normalize(text); const existing = items.find((item) => item.word === (existingWord || word));
  if (existingWord && !existing) throw new Error('短语不存在');
  if (existing && existing.kind !== 'phrase') throw new Error('这个内容已经在生词本中');
  if (!existingWord && existing) return writeLocalVocabulary(items.map((item) => item.word === word ? { ...item, text, meaning: value.meaning.trim(), note: value.note.trim(), example: value.example.trim() } : item));
  if (existingWord && word !== existingWord && items.some((item) => item.word === word)) throw new Error('这个短语已经在生词本中');
  const phrase: VocabularyItem = { word, text, kind: 'phrase', meaning: value.meaning.trim(), note: value.note.trim(), example: value.example.trim(), lessonId: value.lessonId, cueId: value.cueId, addedAt: existing?.addedAt || Date.now(), reviewCount: existing?.reviewCount || 0, lastReviewedAt: existing?.lastReviewedAt || null, groupIndex: 0 };
  return writeLocalVocabulary(existing ? items.map((item) => item.word === existingWord ? phrase : item) : [...items, phrase]);
}

export function removeLocalPhrase(items: VocabularyItem[], word: string) {
  const normalized = normalize(word); const phrase = items.find((item) => item.word === normalized && item.kind === 'phrase');
  if (!phrase) throw new Error('短语不存在');
  return writeLocalVocabulary(items.filter((item) => item.word !== normalized));
}

export function reviewLocalVocabulary(items: VocabularyItem[], groupIndex: number, words: string[]) {
  const normalizedItems = withGroups(items);
  const group = normalizedItems.slice(groupIndex * 10, groupIndex * 10 + 10);
  const selected = new Set(words.map(normalize));
  const isCompleteGroup = group.length > 0
    && selected.size === group.length
    && words.length === group.length
    && group.every((item) => selected.has(item.word));
  if (!isCompleteGroup) throw new Error('复习组内容已变化，请重新开始本组');
  const reviewedAt = Date.now();
  return writeLocalVocabulary(normalizedItems.map((item) => selected.has(item.word) ? { ...item, reviewCount: item.reviewCount + 1, lastReviewedAt: reviewedAt } : item));
}

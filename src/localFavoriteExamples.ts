import type { FavoriteExample } from './types';

const STORAGE_KEY = 'echoline-local-favorite-examples-v1';

export type FavoriteExampleValue = Omit<FavoriteExample, 'id' | 'createdAt'>;

function newId() {
  return globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function validItem(value: unknown): value is FavoriteExample {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<FavoriteExample>;
  return typeof item.id === 'string' && typeof item.lessonId === 'string' && typeof item.cueId === 'string'
    && typeof item.sentence === 'string' && typeof item.translation === 'string' && typeof item.sourceUrl === 'string';
}

function sorted(items: FavoriteExample[]) {
  return [...items].sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id));
}

export function readLocalFavoriteExamples() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return sorted(parsed.filter(validItem).map((item) => ({
      ...item,
      courseName: item.courseName || '未分类课程',
      lessonTitle: item.lessonTitle || '未命名课时',
      startSeconds: Number.isFinite(item.startSeconds) ? item.startSeconds : 0,
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
    })));
  } catch { return []; }
}

export function writeLocalFavoriteExamples(items: FavoriteExample[]) {
  const next = sorted(items);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function clearLocalFavoriteExamples() { localStorage.removeItem(STORAGE_KEY); }

export function saveLocalFavoriteExample(items: FavoriteExample[], value: FavoriteExampleValue) {
  const existing = items.find((item) => item.lessonId === value.lessonId && item.cueId === value.cueId);
  if (existing) return writeLocalFavoriteExamples(items);
  return writeLocalFavoriteExamples([{ ...value, id: newId(), createdAt: Date.now() }, ...items]);
}

export function removeLocalFavoriteExample(items: FavoriteExample[], id: string) {
  return writeLocalFavoriteExamples(items.filter((item) => item.id !== id));
}

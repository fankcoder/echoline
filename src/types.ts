export type Cue = { id: string; start: number; end: number; en: string; zh: string | null };
export type Lesson = {
  id: string; sourceUrl: string; canonicalUrl: string; sourceVideoId: string | null; title: string;
  duration: number | null; manifestRevision: number; importStatus: 'pending' | 'ready' | 'failed';
  captionStatus: 'pending' | 'ready' | 'failed'; translationStatus: 'idle' | 'running' | 'ready' | 'failed';
  translationProgress: number; cueCount: number; position?: number;
};
export type Course = { id: string; name: string; createdAt: number; updatedAt: number; lessons: Lesson[] };
export type VocabularyItem = { word: string; text: string; kind: 'word' | 'phrase'; meaning: string; note: string; example: string; lessonId: string | null; cueId: string | null; addedAt: number; reviewCount: number; lastReviewedAt: number | null; groupIndex: number };
export type Settings = { darkMode?: boolean; videoHidden?: boolean; waitSeconds?: number; repeatCount?: number; selectedCourseId?: string; currentLessonId?: string; localStorageMigrated?: boolean; [key: string]: unknown };
export type Stats = { playbackSeconds: number; sessionSeconds: number; learnedLessons: number };
export type Bootstrap = { courses: Course[]; vocabulary: VocabularyItem[]; settings: Settings; stats: Stats; migrationVersion: number };
export type LessonManifest = {
  lesson: Lesson; cues: Cue[]; captionSource: 'official' | 'llm' | null;
  progress: { playbackSeconds: number; sessionSeconds: number; positionSeconds: number; activeCue: number; completedCueIds: string[]; lastStudiedAt?: number };
  playback: { mediaUrl: string; resolvedAt: number; resolverVersion: string } | null;
};
export type DictionaryEntry = { word: string; ipa: string; type: string; meaning: string; note: string; example: string; audio: string; source: string };
export type DictionarySearchDirection = 'en-zh' | 'zh-en';
export type DictionarySearchResult = { direction: DictionarySearchDirection; query: string; entries: DictionaryEntry[] };

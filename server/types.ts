import { z } from 'zod';

export const resolveLessonSchema = z.object({
  sourceUrl: z.string().url(),
  title: z.string().trim().max(300).optional(),
  lessonId: z.string().uuid().optional(),
});

export const createCourseSchema = z.object({ name: z.string().trim().min(1).max(120) });
export const updateCourseSchema = createCourseSchema.partial();
export const addLessonSchema = z.object({
  sourceUrl: z.string().url(),
  title: z.string().trim().max(300).optional(),
  lessonId: z.string().uuid().optional(),
});
export const reorderSchema = z.object({ lessonIds: z.array(z.string().uuid()) });
export const progressSchema = z.object({
  playbackSeconds: z.number().min(0).optional(),
  sessionSeconds: z.number().min(0).optional(),
  positionSeconds: z.number().min(0).optional(),
  activeCue: z.number().int().min(0).optional(),
  completedCueIds: z.array(z.string()).optional(),
});
const settingValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const settingsSchema = z.object({
  waitSeconds: z.number().int().min(1).max(15).optional(),
  repeatCount: z.number().int().min(0).max(9).optional(),
}).catchall(settingValueSchema);
export const vocabularySchema = z.object({
  word: z.string().trim().min(1).max(80),
  lessonId: z.string().uuid().nullable().optional(),
  cueId: z.string().nullable().optional(),
});
export const phraseSchema = z.object({
  phrase: z.string().trim().min(2).max(160).refine((value) => value.trim().split(/\s+/).length >= 2, '短语至少包含两个单词'), meaning: z.string().trim().min(1).max(500),
  note: z.string().trim().max(500).optional(), example: z.string().trim().max(500).optional(),
  lessonId: z.string().uuid().nullable().optional(), cueId: z.string().max(160).nullable().optional(),
});
export const phraseUpdateSchema = phraseSchema.pick({ phrase: true, meaning: true, note: true, example: true });

export type Cue = { id: string; start: number; end: number; en: string; zh: string | null };

export type PublicLesson = {
  id: string;
  sourceUrl: string;
  canonicalUrl: string;
  sourceVideoId: string | null;
  title: string;
  duration: number | null;
  manifestRevision: number;
  importStatus: string;
  captionStatus: string;
  translationStatus: string;
  translationProgress: number;
  cueCount: number;
  position?: number;
};

export type Course = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  lessons: PublicLesson[];
};

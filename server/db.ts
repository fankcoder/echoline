import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { Course, Cue, PublicLesson } from './types.js';

const schema = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL);
INSERT INTO schema_meta(version) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_meta);
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY, source_url TEXT NOT NULL, canonical_url TEXT NOT NULL UNIQUE,
  source_video_id TEXT, title TEXT NOT NULL, duration REAL, manifest_revision INTEGER NOT NULL DEFAULT 0,
  import_status TEXT NOT NULL DEFAULT 'pending', caption_status TEXT NOT NULL DEFAULT 'pending',
  translation_status TEXT NOT NULL DEFAULT 'idle', translation_progress REAL NOT NULL DEFAULT 0,
  resolver_version TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS course_lessons (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, added_at INTEGER NOT NULL,
  PRIMARY KEY(course_id, lesson_id), UNIQUE(course_id, position)
);
CREATE TABLE IF NOT EXISTS caption_tracks (
  id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  language TEXT NOT NULL, source_kind TEXT NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL, UNIQUE(lesson_id, language, content_hash)
);
CREATE TABLE IF NOT EXISTS translations (
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  cue_id TEXT NOT NULL, source_hash TEXT NOT NULL, target_language TEXT NOT NULL,
  provider TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL,
  text TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(lesson_id, cue_id, source_hash, target_language, provider, model, prompt_version)
);
CREATE TABLE IF NOT EXISTS study_progress (
  lesson_id TEXT PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
  playback_seconds REAL NOT NULL DEFAULT 0, session_seconds REAL NOT NULL DEFAULT 0,
  position_seconds REAL NOT NULL DEFAULT 0, active_cue INTEGER NOT NULL DEFAULT 0,
  completed_cue_ids TEXT NOT NULL DEFAULT '[]', last_studied_at INTEGER, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS vocabulary (
  word TEXT PRIMARY KEY, lesson_id TEXT, cue_id TEXT, added_at INTEGER NOT NULL,
  review_count INTEGER NOT NULL DEFAULT 0, last_reviewed_at INTEGER
);
CREATE TABLE IF NOT EXISTS dictionary_cache (
  word TEXT PRIMARY KEY, payload TEXT NOT NULL, source TEXT NOT NULL, version TEXT NOT NULL,
  expires_at INTEGER, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS review_records (
  id TEXT PRIMARY KEY, group_index INTEGER NOT NULL, words TEXT NOT NULL, reviewed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
`;

export function canonicalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

export class EchoDatabase {
  readonly db: DatabaseSync;

  constructor(filename = process.env.ECHOLINE_DB || resolve('data/echoline.db')) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(schema);
    this.seed();
    const lessons = this.db.prepare('SELECT id FROM lessons').all() as Array<{ id: string }>;
    lessons.forEach(({ id }) => this.updateTranslationCoverage(id));
  }

  private seed() {
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM courses').get() as { count: number };
    if (!count.count) {
      const now = Date.now();
      this.db.prepare('INSERT INTO courses(id,name,created_at,updated_at) VALUES(?,?,?,?)')
        .run('ai-prompting', 'AI Prompting for Everyone', now, now);
    }
    const defaults: Record<string, unknown> = { darkMode: false, videoHidden: false, waitSeconds: 3, repeatCount: 1, selectedCourseId: 'ai-prompting' };
    const statement = this.db.prepare('INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES(?,?,?)');
    for (const [key, value] of Object.entries(defaults)) statement.run(key, JSON.stringify(value), Date.now());
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  listCourses(): Course[] {
    const courses = this.db.prepare('SELECT * FROM courses ORDER BY created_at').all() as any[];
    const lessonRows = this.db.prepare(`SELECT l.*, cl.course_id, cl.position,
      (SELECT COUNT(*) FROM caption_tracks ct WHERE ct.lesson_id=l.id AND ct.language='en') AS cue_tracks,
      COALESCE((SELECT json_array_length(ct.content) FROM caption_tracks ct WHERE ct.lesson_id=l.id AND ct.language='en' ORDER BY ct.created_at DESC LIMIT 1),0) AS cue_count
      FROM course_lessons cl JOIN lessons l ON l.id=cl.lesson_id ORDER BY cl.course_id, cl.position`).all() as any[];
    return courses.map((course) => ({
      id: course.id, name: course.name, createdAt: course.created_at, updatedAt: course.updated_at,
      lessons: lessonRows.filter((lesson) => lesson.course_id === course.id).map((lesson) => this.toPublicLesson(lesson)),
    }));
  }

  createCourse(name: string): Course {
    const id = randomUUID(); const now = Date.now();
    this.db.prepare('INSERT INTO courses(id,name,created_at,updated_at) VALUES(?,?,?,?)').run(id, name, now, now);
    return { id, name, createdAt: now, updatedAt: now, lessons: [] };
  }

  updateCourse(id: string, name: string): boolean {
    return this.db.prepare('UPDATE courses SET name=?, updated_at=? WHERE id=?').run(name, Date.now(), id).changes > 0;
  }

  deleteCourse(id: string): boolean {
    return this.db.prepare('DELETE FROM courses WHERE id=?').run(id).changes > 0;
  }

  upsertPendingLesson(sourceUrl: string, title?: string, requestedId?: string): PublicLesson {
    const canonicalUrl = canonicalizeUrl(sourceUrl);
    const existing = this.db.prepare('SELECT * FROM lessons WHERE canonical_url=?').get(canonicalUrl) as any;
    if (existing) return this.toPublicLesson(existing);
    const id = requestedId || randomUUID(); const now = Date.now();
    this.db.prepare(`INSERT INTO lessons(id,source_url,canonical_url,title,created_at,updated_at)
      VALUES(?,?,?,?,?,?)`).run(id, sourceUrl, canonicalUrl, title || '未命名课时', now, now);
    return this.getLesson(id)!;
  }

  saveResolvedLesson(input: { id: string; sourceUrl: string; sourceVideoId?: string; title: string; duration?: number; cues: Omit<Cue,'zh'>[]; hash: string; officialChinese?: string[] }) {
    const now = Date.now();
    this.transaction(() => {
      this.db.prepare(`UPDATE lessons SET source_url=?,canonical_url=?,source_video_id=?,title=?,duration=?,manifest_revision=manifest_revision+1,
        import_status='ready',caption_status='ready',translation_status=?,translation_progress=?,resolver_version='deeplearning-v1',updated_at=? WHERE id=?`)
        .run(input.sourceUrl, canonicalizeUrl(input.sourceUrl), input.sourceVideoId || null, input.title, input.duration ?? null,
          input.officialChinese?.length ? 'ready' : 'idle', input.officialChinese?.length ? 1 : 0, now, input.id);
      this.db.prepare('INSERT INTO caption_tracks(id,lesson_id,language,source_kind,content,content_hash,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(lesson_id,language,content_hash) DO NOTHING')
        .run(randomUUID(), input.id, 'en', 'official', JSON.stringify(input.cues), input.hash, now);
      if (input.officialChinese?.length === input.cues.length) {
        const zhCues = input.cues.map((cue, index) => ({ ...cue, en: input.officialChinese![index] }));
        this.db.prepare('INSERT INTO caption_tracks(id,lesson_id,language,source_kind,content,content_hash,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(lesson_id,language,content_hash) DO NOTHING')
          .run(randomUUID(), input.id, 'zh-CN', 'official', JSON.stringify(zhCues), input.hash, now);
      }
    });
  }

  markLessonFailed(id: string) {
    this.db.prepare("UPDATE lessons SET import_status='failed',caption_status='failed',updated_at=? WHERE id=?").run(Date.now(), id);
  }

  getLesson(id: string): PublicLesson | null {
    const row = this.db.prepare(`SELECT l.*, COALESCE((SELECT json_array_length(content) FROM caption_tracks WHERE lesson_id=l.id AND language='en' ORDER BY created_at DESC LIMIT 1),0) AS cue_count FROM lessons l WHERE id=?`).get(id) as any;
    return row ? this.toPublicLesson(row) : null;
  }

  getLessonByCanonicalUrl(url: string): PublicLesson | null {
    const row = this.db.prepare('SELECT * FROM lessons WHERE canonical_url=?').get(canonicalizeUrl(url)) as any;
    return row ? this.toPublicLesson(row) : null;
  }

  addLessonToCourse(courseId: string, lessonId: string) {
    const max = this.db.prepare('SELECT COALESCE(MAX(position),-1) AS position FROM course_lessons WHERE course_id=?').get(courseId) as any;
    this.db.prepare('INSERT OR IGNORE INTO course_lessons(course_id,lesson_id,position,added_at) VALUES(?,?,?,?)')
      .run(courseId, lessonId, Number(max.position) + 1, Date.now());
  }

  removeLessonFromCourse(courseId: string, lessonId: string) {
    this.transaction(() => {
      this.db.prepare('DELETE FROM course_lessons WHERE course_id=? AND lesson_id=?').run(courseId, lessonId);
      const rows = this.db.prepare('SELECT lesson_id FROM course_lessons WHERE course_id=? ORDER BY position').all(courseId) as any[];
      const update = this.db.prepare('UPDATE course_lessons SET position=? WHERE course_id=? AND lesson_id=?');
      rows.forEach((row, index) => update.run(index, courseId, row.lesson_id));
    });
  }

  reorderLessons(courseId: string, lessonIds: string[]) {
    this.transaction(() => {
      const existing = this.db.prepare('SELECT lesson_id FROM course_lessons WHERE course_id=?').all(courseId) as any[];
      const expected = new Set(existing.map((row) => row.lesson_id));
      if (lessonIds.length !== expected.size || lessonIds.some((id) => !expected.has(id))) throw new Error('课时顺序与课程内容不一致');
      const offset = lessonIds.length + 10;
      this.db.prepare('UPDATE course_lessons SET position=position+? WHERE course_id=?').run(offset, courseId);
      const update = this.db.prepare('UPDATE course_lessons SET position=? WHERE course_id=? AND lesson_id=?');
      lessonIds.forEach((id, index) => update.run(index, courseId, id));
    });
  }

  updateLesson(id: string, values: { title?: string; sourceUrl?: string }) {
    const lesson = this.getLesson(id); if (!lesson) return false;
    const sourceUrl = values.sourceUrl || lesson.sourceUrl;
    this.db.prepare(`UPDATE lessons SET title=?,source_url=?,canonical_url=?,import_status=?,caption_status=?,updated_at=? WHERE id=?`)
      .run(values.title || lesson.title, sourceUrl, canonicalizeUrl(sourceUrl), values.sourceUrl ? 'pending' : lesson.importStatus, values.sourceUrl ? 'pending' : lesson.captionStatus, Date.now(), id);
    return true;
  }

  getCues(lessonId: string): { cues: Cue[]; sourceHash: string | null; sourceKind: string | null } {
    const enTrack = this.db.prepare("SELECT * FROM caption_tracks WHERE lesson_id=? AND language='en' ORDER BY created_at DESC LIMIT 1").get(lessonId) as any;
    if (!enTrack) return { cues: [], sourceHash: null, sourceKind: null };
    const english = JSON.parse(enTrack.content) as Omit<Cue, 'zh'>[];
    const official = this.db.prepare("SELECT * FROM caption_tracks WHERE lesson_id=? AND language='zh-CN' AND content_hash=? ORDER BY created_at DESC LIMIT 1").get(lessonId, enTrack.content_hash) as any;
    if (official) {
      const chinese = JSON.parse(official.content) as Array<Omit<Cue, 'zh'>>;
      return { cues: english.map((cue, index) => ({ ...cue, zh: chinese[index]?.en || null })), sourceHash: enTrack.content_hash, sourceKind: 'official' };
    }
    const translations = this.db.prepare(`SELECT cue_id,text FROM translations WHERE lesson_id=? AND source_hash=?
      AND created_at=(SELECT MAX(t2.created_at) FROM translations t2 WHERE t2.lesson_id=translations.lesson_id AND t2.cue_id=translations.cue_id AND t2.source_hash=translations.source_hash)`)
      .all(lessonId, enTrack.content_hash) as any[];
    const map = new Map(translations.map((row) => [row.cue_id, row.text]));
    return { cues: english.map((cue) => ({ ...cue, zh: map.get(cue.id) || null })), sourceHash: enTrack.content_hash, sourceKind: map.size ? 'llm' : null };
  }

  getProgress(lessonId: string) {
    const row = this.db.prepare('SELECT * FROM study_progress WHERE lesson_id=?').get(lessonId) as any;
    return row ? { playbackSeconds: row.playback_seconds, sessionSeconds: row.session_seconds, positionSeconds: row.position_seconds, activeCue: row.active_cue, completedCueIds: JSON.parse(row.completed_cue_ids), lastStudiedAt: row.last_studied_at } : { playbackSeconds: 0, sessionSeconds: 0, positionSeconds: 0, activeCue: 0, completedCueIds: [] };
  }

  saveProgress(lessonId: string, input: any) {
    const current = this.getProgress(lessonId); const now = Date.now();
    const value = { ...current, ...input };
    this.db.prepare(`INSERT INTO study_progress(lesson_id,playback_seconds,session_seconds,position_seconds,active_cue,completed_cue_ids,last_studied_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(lesson_id) DO UPDATE SET playback_seconds=excluded.playback_seconds,session_seconds=excluded.session_seconds,
      position_seconds=excluded.position_seconds,active_cue=excluded.active_cue,completed_cue_ids=excluded.completed_cue_ids,last_studied_at=excluded.last_studied_at,updated_at=excluded.updated_at`)
      .run(lessonId, value.playbackSeconds, value.sessionSeconds, value.positionSeconds, value.activeCue, JSON.stringify(value.completedCueIds), now, now);
  }

  getSettings(): Record<string, unknown> {
    const rows = this.db.prepare('SELECT key,value FROM settings').all() as any[];
    return Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value)]));
  }

  saveSettings(values: Record<string, unknown>) {
    const statement = this.db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at');
    this.transaction(() => Object.entries(values).forEach(([key, value]) => statement.run(key, JSON.stringify(value), Date.now())));
  }

  listVocabulary() {
    return (this.db.prepare('SELECT * FROM vocabulary ORDER BY added_at').all() as any[]).map((row, index) => ({ word: row.word, lessonId: row.lesson_id, cueId: row.cue_id, addedAt: row.added_at, reviewCount: row.review_count, lastReviewedAt: row.last_reviewed_at, groupIndex: Math.floor(index / 10) }));
  }

  toggleVocabulary(word: string, lessonId?: string | null, cueId?: string | null): boolean {
    const normalized = word.toLowerCase();
    if (this.db.prepare('SELECT word FROM vocabulary WHERE word=?').get(normalized)) { this.db.prepare('DELETE FROM vocabulary WHERE word=?').run(normalized); return false; }
    this.db.prepare('INSERT INTO vocabulary(word,lesson_id,cue_id,added_at) VALUES(?,?,?,?)').run(normalized, lessonId || null, cueId || null, Date.now());
    return true;
  }

  recordReview(groupIndex: number, words: string[]) {
    const now = Date.now();
    this.transaction(() => {
      this.db.prepare('INSERT INTO review_records(id,group_index,words,reviewed_at) VALUES(?,?,?,?)').run(randomUUID(), groupIndex, JSON.stringify(words), now);
      const update = this.db.prepare('UPDATE vocabulary SET review_count=review_count+1,last_reviewed_at=? WHERE word=?');
      words.forEach((word) => update.run(now, word));
    });
  }

  getDictionary(word: string) { const row = this.db.prepare('SELECT * FROM dictionary_cache WHERE word=?').get(word) as any; return row ? JSON.parse(row.payload) : null; }
  saveDictionary(word: string, payload: unknown, source: string, version = 'v1') { this.db.prepare('INSERT INTO dictionary_cache(word,payload,source,version,expires_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(word) DO UPDATE SET payload=excluded.payload,source=excluded.source,version=excluded.version,expires_at=excluded.expires_at,updated_at=excluded.updated_at').run(word, JSON.stringify(payload), source, version, Date.now() + 365 * 86400000, Date.now()); }

  createJob(lessonId: string) { const id = randomUUID(); const now = Date.now(); this.db.prepare("INSERT INTO jobs(id,lesson_id,type,status,progress,created_at,updated_at) VALUES(?,?,'translation','queued',0,?,?)").run(id, lessonId, now, now); return id; }
  updateJob(id: string, status: string, progress: number, error?: string) { this.db.prepare('UPDATE jobs SET status=?,progress=?,error=?,updated_at=? WHERE id=?').run(status, progress, error || null, Date.now(), id); }
  getJob(id: string) { const row = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as any; return row ? { id: row.id, lessonId: row.lesson_id, type: row.type, status: row.status, progress: row.progress, error: row.error, createdAt: row.created_at, updatedAt: row.updated_at } : null; }
  setTranslationState(lessonId: string, status: string, progress: number) { this.db.prepare('UPDATE lessons SET translation_status=?,translation_progress=?,updated_at=? WHERE id=?').run(status, progress, Date.now(), lessonId); }
  updateTranslationCoverage(lessonId: string) {
    const { cues } = this.getCues(lessonId); const translated = cues.filter((cue) => cue.zh).length;
    const progress = cues.length ? translated / cues.length : 0;
    this.db.prepare('UPDATE lessons SET translation_status=?,translation_progress=? WHERE id=?').run(cues.length && translated === cues.length ? 'ready' : 'idle', progress, lessonId);
    return progress;
  }
  saveTranslations(lessonId: string, sourceHash: string, rows: Array<{ id: string; text: string }>, provider: string, model: string, promptVersion: string) { const statement = this.db.prepare('INSERT OR REPLACE INTO translations(lesson_id,cue_id,source_hash,target_language,provider,model,prompt_version,text,created_at) VALUES(?,?,?,?,?,?,?,?,?)'); this.transaction(() => rows.forEach((row) => statement.run(lessonId, row.id, sourceHash, 'zh-CN', provider, model, promptVersion, row.text, Date.now()))); }

  exportData() {
    const courses = this.listCourses();
    const lessonIds = [...new Set(courses.flatMap((course) => course.lessons.map((lesson) => lesson.id)))];
    return { version: 1, exportedAt: Date.now(), courses, progress: lessonIds.map((lessonId) => ({ lessonId, ...this.getProgress(lessonId) })), vocabulary: this.listVocabulary(), settings: this.getSettings() };
  }

  private toPublicLesson(row: any): PublicLesson {
    return { id: row.id, sourceUrl: row.source_url, canonicalUrl: row.canonical_url, sourceVideoId: row.source_video_id || null, title: row.title, duration: row.duration ?? null, manifestRevision: row.manifest_revision || 0, importStatus: row.import_status, captionStatus: row.caption_status, translationStatus: row.translation_status, translationProgress: row.translation_progress || 0, cueCount: Number(row.cue_count || 0), ...(row.position === undefined ? {} : { position: row.position }) };
  }

  close() { this.db.close(); }
}

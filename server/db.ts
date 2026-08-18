import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
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
  word TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'word', display_text TEXT, normalized_text TEXT,
  meaning TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', example TEXT NOT NULL DEFAULT '',
  lesson_id TEXT, cue_id TEXT, added_at INTEGER NOT NULL,
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
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT,
  display_name TEXT NOT NULL, avatar_url TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_identities (
  provider TEXT NOT NULL, provider_subject TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, PRIMARY KEY(provider, provider_subject)
);
CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY, provider TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_vocabulary (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, word TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'word', display_text TEXT, normalized_text TEXT,
  meaning TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', example TEXT NOT NULL DEFAULT '',
  lesson_id TEXT, cue_id TEXT, added_at INTEGER NOT NULL,
  review_count INTEGER NOT NULL DEFAULT 0, last_reviewed_at INTEGER,
  PRIMARY KEY(user_id, word)
);
CREATE INDEX IF NOT EXISTS user_vocabulary_by_user_added_at ON user_vocabulary(user_id, added_at, word);
CREATE TABLE IF NOT EXISTS user_favorite_examples (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL,
  lesson_id TEXT NOT NULL, cue_id TEXT NOT NULL, sentence TEXT NOT NULL, translation TEXT NOT NULL,
  course_name TEXT NOT NULL, lesson_title TEXT NOT NULL, source_url TEXT NOT NULL,
  start_seconds REAL NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, id), UNIQUE(user_id, lesson_id, cue_id)
);
CREATE INDEX IF NOT EXISTS user_favorite_examples_by_user_created_at ON user_favorite_examples(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS data_migrations (
  name TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE SET NULL, completed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
`;

export function canonicalizeUrl(value: string): string {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const youtubeHost = host === 'youtu.be' || ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host);
  const pathParts = url.pathname.split('/').filter(Boolean);
  const youtubeId = host === 'youtu.be' ? pathParts[0] : url.pathname === '/watch' ? url.searchParams.get('v') : ['embed', 'shorts', 'live'].includes(pathParts[0] || '') ? pathParts[1] : null;
  if (youtubeHost && youtubeId && /^[A-Za-z0-9_-]{11}$/.test(youtubeId)) return `https://www.youtube.com/watch?v=${youtubeId}`;
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
    this.migrate();
    this.seed();
    const lessons = this.db.prepare('SELECT id FROM lessons').all() as Array<{ id: string }>;
    lessons.forEach(({ id }) => this.updateTranslationCoverage(id));
  }

  private migrate() {
    const columns = new Set((this.db.prepare('PRAGMA table_info(vocabulary)').all() as Array<{ name: string }>).map((column) => column.name));
    const additions: Array<[string, string]> = [
      ['kind', "TEXT NOT NULL DEFAULT 'word'"], ['display_text', 'TEXT'], ['normalized_text', 'TEXT'],
      ['meaning', "TEXT NOT NULL DEFAULT ''"], ['note', "TEXT NOT NULL DEFAULT ''"], ['example', "TEXT NOT NULL DEFAULT ''"],
    ];
    additions.forEach(([name, definition]) => { if (!columns.has(name)) this.db.exec(`ALTER TABLE vocabulary ADD COLUMN ${name} ${definition}`); });
    const reviewColumns = new Set((this.db.prepare('PRAGMA table_info(review_records)').all() as Array<{ name: string }>).map((column) => column.name));
    if (!reviewColumns.has('user_id')) this.db.exec('ALTER TABLE review_records ADD COLUMN user_id TEXT');
    this.db.exec("UPDATE vocabulary SET display_text=COALESCE(display_text,word), normalized_text=COALESCE(normalized_text,word), kind=COALESCE(kind,'word')");
    this.db.prepare('UPDATE schema_meta SET version=5').run();
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

  saveResolvedLesson(input: { id: string; sourceUrl: string; sourceVideoId?: string; title: string; duration?: number; cues: Omit<Cue,'zh'>[]; hash: string; officialChinese?: string[]; captionStatus?: 'ready' | 'unavailable'; resolverVersion?: string }) {
    const now = Date.now();
    this.transaction(() => {
      this.db.prepare(`UPDATE lessons SET source_url=?,canonical_url=?,source_video_id=?,title=?,duration=?,manifest_revision=manifest_revision+1,
        import_status='ready',caption_status=?,translation_status=?,translation_progress=?,resolver_version=?,updated_at=? WHERE id=?`)
        .run(input.sourceUrl, canonicalizeUrl(input.sourceUrl), input.sourceVideoId || null, input.title, input.duration ?? null,
          input.captionStatus || 'ready', input.officialChinese?.length ? 'ready' : 'idle', input.officialChinese?.length ? 1 : 0, input.resolverVersion || 'deeplearning-v1', now, input.id);
      this.db.prepare("DELETE FROM caption_tracks WHERE lesson_id=? AND language IN ('en','zh-CN')").run(input.id);
      if (input.cues.length) this.db.prepare('INSERT INTO caption_tracks(id,lesson_id,language,source_kind,content,content_hash,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(randomUUID(), input.id, 'en', 'official', JSON.stringify(input.cues), input.hash, now);
      if (input.cues.length && input.officialChinese?.length === input.cues.length) {
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

  listFavoriteExamples(userId: string) {
    return (this.db.prepare('SELECT * FROM user_favorite_examples WHERE user_id=? ORDER BY created_at DESC, id DESC').all(userId) as any[]).map((row) => ({
      id: row.id, lessonId: row.lesson_id, cueId: row.cue_id, sentence: row.sentence, translation: row.translation,
      courseName: row.course_name, lessonTitle: row.lesson_title, sourceUrl: row.source_url, startSeconds: row.start_seconds, createdAt: row.created_at,
    }));
  }

  addFavoriteExample(userId: string, lessonId: string, cueId: string, courseId?: string) {
    const lesson = this.getLesson(lessonId); if (!lesson) throw new Error('课时不存在');
    const cue = this.getCues(lessonId).cues.find((item) => item.id === cueId); if (!cue) throw new Error('字幕不存在');
    if (!cue.zh) throw new Error('请先翻译本句后再收藏');
    const existing = this.db.prepare('SELECT id FROM user_favorite_examples WHERE user_id=? AND lesson_id=? AND cue_id=?').get(userId, lessonId, cueId) as { id: string } | undefined;
    if (existing) return { saved: false, favoriteExamples: this.listFavoriteExamples(userId) };
    const course = courseId
      ? this.db.prepare('SELECT c.name FROM courses c JOIN course_lessons cl ON cl.course_id=c.id WHERE c.id=? AND cl.lesson_id=?').get(courseId, lessonId) as { name: string } | undefined
      : this.db.prepare('SELECT c.name FROM courses c JOIN course_lessons cl ON cl.course_id=c.id WHERE cl.lesson_id=? ORDER BY cl.added_at LIMIT 1').get(lessonId) as { name: string } | undefined;
    this.db.prepare(`INSERT INTO user_favorite_examples(user_id,id,lesson_id,cue_id,sentence,translation,course_name,lesson_title,source_url,start_seconds,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(userId, randomUUID(), lessonId, cueId, cue.en, cue.zh, course?.name || '未分类课程', lesson.title, lesson.sourceUrl, cue.start, Date.now());
    return { saved: true, favoriteExamples: this.listFavoriteExamples(userId) };
  }

  removeFavoriteExample(userId: string, id: string) {
    return this.db.prepare('DELETE FROM user_favorite_examples WHERE user_id=? AND id=?').run(userId, id).changes > 0;
  }

  syncUserFavoriteExamples(userId: string, items: Array<{ lessonId: string; cueId: string; sentence: string; translation: string; courseName?: string; lessonTitle?: string; sourceUrl: string; startSeconds?: number; createdAt?: number }>) {
    const seen = new Set<string>();
    const insert = this.db.prepare(`INSERT OR IGNORE INTO user_favorite_examples(user_id,id,lesson_id,cue_id,sentence,translation,course_name,lesson_title,source_url,start_seconds,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    this.transaction(() => items.forEach((item) => {
      const key = `${item.lessonId}:${item.cueId}`;
      if (seen.has(key)) return;
      seen.add(key);
      const startSeconds = typeof item.startSeconds === 'number' && Number.isFinite(item.startSeconds) ? item.startSeconds : 0;
      const createdAt = typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : Date.now();
      insert.run(userId, randomUUID(), item.lessonId, item.cueId, item.sentence, item.translation, item.courseName || '未分类课程', item.lessonTitle || '未命名课时', item.sourceUrl, startSeconds, createdAt);
    }));
    return this.listFavoriteExamples(userId);
  }

  createUser(email: string, passwordHash: string | null, displayName: string, avatarUrl: string | null = null) {
    const id = randomUUID(); const now = Date.now();
    this.db.prepare('INSERT INTO users(id,email,password_hash,display_name,avatar_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(id, email, passwordHash, displayName, avatarUrl, now, now);
    return this.getUser(id)!;
  }

  getUser(id: string) {
    const row = this.db.prepare('SELECT * FROM users WHERE id=?').get(id) as any;
    return row ? this.toPublicUser(row) : null;
  }

  getUserByEmail(email: string) {
    const row = this.db.prepare('SELECT * FROM users WHERE email=?').get(email) as any;
    return row || null;
  }

  getUserByIdentity(provider: string, providerSubject: string) {
    const row = this.db.prepare('SELECT u.* FROM oauth_identities oi JOIN users u ON u.id=oi.user_id WHERE oi.provider=? AND oi.provider_subject=?').get(provider, providerSubject) as any;
    return row ? this.toPublicUser(row) : null;
  }

  addOAuthIdentity(provider: string, providerSubject: string, userId: string) {
    this.db.prepare('INSERT INTO oauth_identities(provider,provider_subject,user_id,created_at) VALUES(?,?,?,?)').run(provider, providerSubject, userId, Date.now());
  }

  createSession(userId: string, token: string, expiresAt: number) {
    this.db.prepare('INSERT INTO user_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(this.hashSecret(token), userId, expiresAt, Date.now());
  }

  getSessionUser(token: string) {
    const row = this.db.prepare('SELECT u.* FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(this.hashSecret(token), Date.now()) as any;
    return row ? this.toPublicUser(row) : null;
  }

  deleteSession(token: string) {
    this.db.prepare('DELETE FROM user_sessions WHERE token_hash=?').run(this.hashSecret(token));
  }

  createOAuthState(state: string, provider: string, expiresAt: number) {
    this.db.prepare('INSERT INTO oauth_states(state_hash,provider,expires_at,created_at) VALUES(?,?,?,?)').run(this.hashSecret(state), provider, expiresAt, Date.now());
  }

  consumeOAuthState(state: string, provider: string) {
    const hash = this.hashSecret(state); const now = Date.now();
    return this.transaction(() => {
      const row = this.db.prepare('SELECT state_hash FROM oauth_states WHERE state_hash=? AND provider=? AND expires_at>?').get(hash, provider, now) as { state_hash: string } | undefined;
      this.db.prepare('DELETE FROM oauth_states WHERE state_hash=?').run(hash);
      this.db.prepare('DELETE FROM oauth_states WHERE expires_at<=?').run(now);
      return Boolean(row);
    });
  }

  listVocabulary(userId?: string) {
    const rows = (userId
      ? this.db.prepare('SELECT * FROM user_vocabulary WHERE user_id=? ORDER BY added_at, word').all(userId)
      : this.db.prepare('SELECT * FROM vocabulary ORDER BY added_at, word').all()) as any[];
    return rows.map((row, index) => this.toVocabulary(row, index));
  }

  toggleVocabulary(word: string, lessonId?: string | null, cueId?: string | null, userId?: string): boolean {
    const normalized = word.toLowerCase().trim();
    if (userId) {
      if (this.db.prepare('SELECT word FROM user_vocabulary WHERE user_id=? AND word=?').get(userId, normalized)) { this.db.prepare('DELETE FROM user_vocabulary WHERE user_id=? AND word=?').run(userId, normalized); return false; }
      this.db.prepare('INSERT INTO user_vocabulary(user_id,word,kind,display_text,normalized_text,lesson_id,cue_id,added_at) VALUES(?,?,?,?,?,?,?,?)').run(userId, normalized, 'word', normalized, normalized, lessonId || null, cueId || null, Date.now());
      return true;
    }
    if (this.db.prepare('SELECT word FROM vocabulary WHERE word=?').get(normalized)) { this.db.prepare('DELETE FROM vocabulary WHERE word=?').run(normalized); return false; }
    this.db.prepare('INSERT INTO vocabulary(word,kind,display_text,normalized_text,lesson_id,cue_id,added_at) VALUES(?,?,?,?,?,?,?)').run(normalized, 'word', normalized, normalized, lessonId || null, cueId || null, Date.now());
    return true;
  }

  addPhrase(text: string, meaning: string, note = '', example = '', lessonId?: string | null, cueId?: string | null, userId?: string) {
    const displayText = text.replace(/\s+/g, ' ').trim(); const normalized = displayText.toLowerCase();
    if (userId) {
      const existing = this.db.prepare('SELECT * FROM user_vocabulary WHERE user_id=? AND word=?').get(userId, normalized) as any;
      if (existing) {
        if (existing.kind !== 'phrase') throw new Error('这个内容已经在生词本中');
        this.db.prepare('UPDATE user_vocabulary SET meaning=?,note=?,example=? WHERE user_id=? AND word=?').run(meaning.trim(), note.trim(), example.trim(), userId, normalized);
        return { saved: false, item: this.listVocabulary(userId).find((item) => item.word === normalized) };
      }
      this.db.prepare('INSERT INTO user_vocabulary(user_id,word,kind,display_text,normalized_text,meaning,note,example,lesson_id,cue_id,added_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(userId, normalized, 'phrase', displayText, normalized, meaning.trim(), note.trim(), example.trim(), lessonId || null, cueId || null, Date.now());
      return { saved: true, item: this.listVocabulary(userId).find((item) => item.word === normalized) };
    }
    const existing = this.db.prepare('SELECT * FROM vocabulary WHERE word=?').get(normalized) as any;
    if (existing) {
      if (existing.kind !== 'phrase') throw new Error('这个内容已经在生词本中');
      this.db.prepare('UPDATE vocabulary SET meaning=?,note=?,example=? WHERE word=?').run(meaning.trim(), note.trim(), example.trim(), normalized);
      return { saved: false, item: this.listVocabulary().find((item) => item.word === normalized) };
    }
    this.db.prepare('INSERT INTO vocabulary(word,kind,display_text,normalized_text,meaning,note,example,lesson_id,cue_id,added_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(normalized, 'phrase', displayText, normalized, meaning.trim(), note.trim(), example.trim(), lessonId || null, cueId || null, Date.now());
    return { saved: true, item: this.listVocabulary().find((item) => item.word === normalized) };
  }

  updatePhrase(normalizedText: string, text: string, meaning: string, note = '', example = '', userId?: string) {
    const normalized = normalizedText.toLowerCase().replace(/\s+/g, ' ').trim(); const displayText = text.replace(/\s+/g, ' ').trim(); const nextNormalized = displayText.toLowerCase();
    if (userId) {
      const row = this.db.prepare('SELECT kind FROM user_vocabulary WHERE user_id=? AND word=?').get(userId, normalized) as { kind: string } | undefined;
      if (!row || row.kind !== 'phrase') return 'not_found';
      if (nextNormalized !== normalized && this.db.prepare('SELECT word FROM user_vocabulary WHERE user_id=? AND word=?').get(userId, nextNormalized)) return 'duplicate';
      this.db.prepare('UPDATE user_vocabulary SET word=?,display_text=?,normalized_text=?,meaning=?,note=?,example=? WHERE user_id=? AND word=?').run(nextNormalized, displayText, nextNormalized, meaning.trim(), note.trim(), example.trim(), userId, normalized);
      return 'updated';
    }
    const row = this.db.prepare('SELECT kind FROM vocabulary WHERE word=?').get(normalized) as { kind: string } | undefined;
    if (!row || row.kind !== 'phrase') return 'not_found';
    if (nextNormalized !== normalized && this.db.prepare('SELECT word FROM vocabulary WHERE word=?').get(nextNormalized)) return 'duplicate';
    this.db.prepare('UPDATE vocabulary SET word=?,display_text=?,normalized_text=?,meaning=?,note=?,example=? WHERE word=?').run(nextNormalized, displayText, nextNormalized, meaning.trim(), note.trim(), example.trim(), normalized);
    return 'updated';
  }

  removePhrase(normalizedText: string, userId?: string) {
    const normalized = normalizedText.toLowerCase().replace(/\s+/g, ' ').trim();
    if (userId) return this.db.prepare("DELETE FROM user_vocabulary WHERE user_id=? AND word=? AND kind='phrase'").run(userId, normalized).changes > 0;
    return this.db.prepare("DELETE FROM vocabulary WHERE word=? AND kind='phrase'").run(normalized).changes > 0;
  }

  recordReview(groupIndex: number, items: Array<{ word: string; kind?: string }>, userId?: string) {
    const group = this.listVocabulary(userId).slice(groupIndex * 10, groupIndex * 10 + 10);
    const supplied = new Set(items.map((item) => item.word.toLowerCase().replace(/\s+/g, ' ').trim()));
    const isCompleteGroup = group.length > 0
      && supplied.size === group.length
      && items.length === group.length
      && group.every((item) => supplied.has(item.word));
    if (!isCompleteGroup) return false;
    const now = Date.now();
    this.transaction(() => {
      this.db.prepare('INSERT INTO review_records(id,group_index,words,reviewed_at,user_id) VALUES(?,?,?,?,?)').run(randomUUID(), groupIndex, JSON.stringify(group.map((item) => ({ word: item.word, kind: item.kind }))), now, userId || null);
      const update = userId ? this.db.prepare('UPDATE user_vocabulary SET review_count=review_count+1,last_reviewed_at=? WHERE user_id=? AND word=?') : this.db.prepare('UPDATE vocabulary SET review_count=review_count+1,last_reviewed_at=? WHERE word=?');
      group.forEach((item) => userId ? update.run(now, userId, item.word) : update.run(now, item.word));
    });
    return true;
  }

  syncUserVocabulary(userId: string, items: Array<{ word: string; text?: string; kind?: string; meaning?: string; note?: string; example?: string; lessonId?: string | null; cueId?: string | null; addedAt?: number; reviewCount?: number; lastReviewedAt?: number | null }>) {
    const seen = new Set<string>();
    const statement = this.db.prepare(`INSERT OR IGNORE INTO user_vocabulary(user_id,word,kind,display_text,normalized_text,meaning,note,example,lesson_id,cue_id,added_at,review_count,last_reviewed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    this.transaction(() => items.forEach((item) => {
      const word = typeof item.word === 'string' ? item.word.toLowerCase().replace(/\s+/g, ' ').trim() : '';
      const kind = item.kind === 'phrase' ? 'phrase' : 'word';
      if (!word || seen.has(word) || (kind === 'phrase' && !item.meaning?.trim())) return;
      seen.add(word);
      const addedAt = typeof item.addedAt === 'number' && Number.isFinite(item.addedAt) ? item.addedAt : Date.now();
      statement.run(userId, word, kind, item.text?.trim() || word, word, item.meaning?.trim() || '', item.note?.trim() || '', item.example?.trim() || '', item.lessonId || null, item.cueId || null, addedAt, Math.max(0, Number(item.reviewCount) || 0), item.lastReviewedAt || null);
    }));
    return this.listVocabulary(userId);
  }

  claimLegacyVocabulary(userId: string) {
    return this.transaction(() => {
      const migrationName = 'legacy_global_vocabulary_v1';
      if (this.db.prepare('SELECT name FROM data_migrations WHERE name=?').get(migrationName)) return 0;
      const result = this.db.prepare(`INSERT OR IGNORE INTO user_vocabulary(user_id,word,kind,display_text,normalized_text,meaning,note,example,lesson_id,cue_id,added_at,review_count,last_reviewed_at)
        SELECT ?,word,COALESCE(kind,'word'),COALESCE(display_text,word),COALESCE(normalized_text,word),COALESCE(meaning,''),COALESCE(note,''),COALESCE(example,''),lesson_id,cue_id,added_at,review_count,last_reviewed_at FROM vocabulary`)
        .run(userId);
      this.db.prepare('INSERT INTO data_migrations(name,user_id,completed_at) VALUES(?,?,?)').run(migrationName, userId, Date.now());
      return result.changes;
    });
  }

  claimLegacyFavoriteExamples(userId: string) {
    const migrationName = 'legacy_global_favorite_examples_v1';
    const exists = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='favorite_examples'").get();
    if (!exists || this.db.prepare('SELECT name FROM data_migrations WHERE name=?').get(migrationName)) return 0;
    return this.transaction(() => {
      const result = this.db.prepare(`INSERT OR IGNORE INTO user_favorite_examples(user_id,id,lesson_id,cue_id,sentence,translation,course_name,lesson_title,source_url,start_seconds,created_at)
        SELECT ?,id,lesson_id,cue_id,sentence,translation,course_name,lesson_title,source_url,start_seconds,created_at FROM favorite_examples`).run(userId);
      this.db.prepare('INSERT INTO data_migrations(name,user_id,completed_at) VALUES(?,?,?)').run(migrationName, userId, Date.now());
      return result.changes;
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

  exportData(userId?: string) {
    const courses = this.listCourses();
    const lessonIds = [...new Set(courses.flatMap((course) => course.lessons.map((lesson) => lesson.id)))];
    return { version: 3, exportedAt: Date.now(), courses, progress: lessonIds.map((lessonId) => ({ lessonId, ...this.getProgress(lessonId) })), vocabulary: this.listVocabulary(userId), favoriteExamples: userId ? this.listFavoriteExamples(userId) : [], settings: this.getSettings() };
  }

  private hashSecret(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private toPublicUser(row: any) {
    return { id: row.id, email: row.email, displayName: row.display_name, avatarUrl: row.avatar_url || null };
  }

  private toVocabulary(row: any, index: number) {
    return { word: row.word, text: row.display_text || row.word, kind: row.kind || 'word', meaning: row.meaning || '', note: row.note || '', example: row.example || '', lessonId: row.lesson_id, cueId: row.cue_id, addedAt: row.added_at, reviewCount: row.review_count, lastReviewedAt: row.last_reviewed_at, groupIndex: Math.floor(index / 10) };
  }

  private toPublicLesson(row: any): PublicLesson {
    return { id: row.id, sourceUrl: row.source_url, canonicalUrl: row.canonical_url, sourceVideoId: row.source_video_id || null, title: row.title, duration: row.duration ?? null, manifestRevision: row.manifest_revision || 0, importStatus: row.import_status, captionStatus: row.caption_status, translationStatus: row.translation_status, translationProgress: row.translation_progress || 0, cueCount: Number(row.cue_count || 0), ...(row.position === undefined ? {} : { position: row.position }) };
  }

  close() { this.db.close(); }
}

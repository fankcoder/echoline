import { resolve } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { z, ZodError } from 'zod';
import { EchoDatabase } from './db.js';
import { lookupWord, searchDictionary } from './dictionary.js';
import { resolveLessonAssets, RESOLVER_VERSION } from './resolver.js';
import { translateCue } from './translation.js';
import { appHomePath, authenticateOAuthUser, clearCookie, cookie, cookieValue, exchangeOAuthProfile, hashPassword, isOAuthNetworkError, normalizeEmail, oauthCookieName, sessionCookieName, sessionExpiry, sessionToken, startOAuth, verifyPassword, type OAuthProvider } from './auth.js';
import { addLessonSchema, createCourseSchema, loginSchema, phraseSchema, phraseUpdateSchema, progressSchema, registerSchema, reorderSchema, resolveLessonSchema, settingsSchema, updateCourseSchema, vocabularySchema, vocabularySyncSchema } from './types.js';

type PlaybackAsset = ({ kind: 'hls'; mediaUrl: string } | { kind: 'youtube'; videoId: string }) & { resolvedAt: number; resolverVersion: string };
const playbackAssets = new Map<string, PlaybackAsset>();
const requests = new Map<string, { count: number; resetAt: number }>();
const LOCAL_ALLOWED_ORIGINS = new Set(['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:4173', 'http://localhost:4173', 'http://127.0.0.1:5174']);

class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message); }
}

function allowedOrigins() {
  const configured = (process.env.PUBLIC_ORIGIN || '').split(',').flatMap((value) => {
    try {
      const url = new URL(value.trim());
      return url.pathname === '/' && !url.search && !url.hash && ['http:', 'https:'].includes(url.protocol) ? [url.origin] : [];
    } catch { return []; }
  });
  return new Set([...LOCAL_ALLOWED_ORIGINS, ...configured]);
}

function errorMessage(error: unknown) {
  if (error instanceof ZodError) return error.issues.map((issue) => issue.message).join('；');
  return error instanceof Error ? error.message : '未知错误';
}

export async function buildApp(options: { database?: EchoDatabase; production?: boolean } = {}): Promise<FastifyInstance> {
  const db = options.database || new EchoDatabase();
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info', redact: ['req.headers.authorization', 'req.url', 'apiKey'] }, bodyLimit: 2 * 1024 * 1024 });

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && !allowedOrigins().has(origin)) return reply.code(403).send({ error: { code: 'ORIGIN_REJECTED', message: '请求来源不受信任' } });
    const key = request.ip; const now = Date.now(); const current = requests.get(key);
    if (!current || current.resetAt < now) requests.set(key, { count: 1, resetAt: now + 60_000 });
    else if (++current.count > 180) return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后重试' } });
  });

  app.setErrorHandler((error, _request, reply) => {
    const validation = error instanceof ZodError;
    const expected = error instanceof HttpError;
    app.log.error({ err: error }, validation ? 'request validation failed' : 'request failed');
    reply.code(expected ? error.statusCode : validation ? 400 : 500).send({ error: { code: expected ? error.code : validation ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR', message: errorMessage(error) } });
  });

  const authUser = (request: FastifyRequest) => {
    const token = cookieValue(request.headers.cookie, sessionCookieName());
    return token ? db.getSessionUser(token) : null;
  };
  const requireUser = (request: FastifyRequest) => {
    const user = authUser(request);
    if (!user) throw new HttpError(401, 'AUTH_REQUIRED', '请先登录后再使用云端生词本');
    return user;
  };

  const hydrate = (lessonId: string) => {
    const lesson = db.getLesson(lessonId); if (!lesson) return null;
    const caption = db.getCues(lessonId); const progress = db.getProgress(lessonId);
    return { lesson, cues: caption.cues, captionSource: caption.sourceKind, progress, playback: playbackAssets.get(lessonId) || null };
  };

  const resolveAndSave = async (sourceUrl: string, title?: string, lessonId?: string) => {
    let lesson = lessonId ? db.getLesson(lessonId) : db.getLessonByCanonicalUrl(sourceUrl);
    lesson ||= db.upsertPendingLesson(sourceUrl, title, lessonId);
    try {
      const assets = await resolveLessonAssets(sourceUrl, title);
      db.saveResolvedLesson({ id: lesson.id, sourceUrl, sourceVideoId: assets.sourceVideoId || undefined, title: title || assets.title, duration: assets.duration || undefined, cues: assets.cues, hash: assets.hash, officialChinese: assets.officialChinese, captionStatus: assets.captionStatus, resolverVersion: RESOLVER_VERSION });
      playbackAssets.set(lesson.id, { ...assets.playback, resolvedAt: Date.now(), resolverVersion: RESOLVER_VERSION });
      return hydrate(lesson.id)!;
    } catch (error) { db.markLessonFailed(lesson.id); throw error; }
  };

  app.get('/api/health', async () => ({ ok: true, version: '1.0.0', resolverVersion: RESOLVER_VERSION }));
  app.get('/api/auth/me', async (request) => ({ user: authUser(request) }));
  app.post('/api/auth/register', async (request, reply) => {
    const input = registerSchema.parse(request.body); const email = normalizeEmail(input.email);
    if (db.getUserByEmail(email)) throw new HttpError(409, 'EMAIL_EXISTS', '该邮箱已经注册，请直接登录');
    const user = db.createUser(email, await hashPassword(input.password), input.displayName || email.split('@')[0]);
    const token = sessionToken(); db.createSession(user.id, token, sessionExpiry());
    reply.header('Set-Cookie', cookie(sessionCookieName(), token));
    reply.code(201).send({ user });
  });
  app.post('/api/auth/login', async (request, reply) => {
    const input = loginSchema.parse(request.body); const account = db.getUserByEmail(normalizeEmail(input.email));
    if (!account || !await verifyPassword(input.password, account.password_hash || null)) throw new HttpError(401, 'INVALID_CREDENTIALS', '邮箱或密码不正确');
    const token = sessionToken(); db.createSession(account.id, token, sessionExpiry());
    reply.header('Set-Cookie', cookie(sessionCookieName(), token));
    reply.send({ user: db.getUser(account.id) });
  });
  app.post('/api/auth/logout', async (request, reply) => {
    const token = cookieValue(request.headers.cookie, sessionCookieName());
    if (token) db.deleteSession(token);
    reply.header('Set-Cookie', clearCookie(sessionCookieName())).send({ ok: true });
  });
  app.get('/api/auth/:provider/start', async (request, reply) => {
    const { provider } = z.object({ provider: z.enum(['github', 'google']) }).parse(request.params) as { provider: OAuthProvider };
    try {
      const oauth = startOAuth(db, provider, request);
      reply.header('Set-Cookie', cookie(oauthCookieName(provider), oauth.state, 10 * 60)).redirect(oauth.url);
    } catch (error) {
      app.log.warn({ err: error, provider }, 'oauth start failed');
      reply.redirect(`${appHomePath()}?authError=oauth_not_configured`);
    }
  });
  app.get('/api/auth/:provider/callback', async (request, reply) => {
    const { provider } = z.object({ provider: z.enum(['github', 'google']) }).parse(request.params) as { provider: OAuthProvider };
    const query = z.object({ code: z.string().min(1).optional(), state: z.string().min(1).optional(), error: z.string().optional() }).parse(request.query);
    const stateCookie = cookieValue(request.headers.cookie, oauthCookieName(provider));
    try {
      if (query.error || !query.code || !query.state || !stateCookie || query.state !== stateCookie || !db.consumeOAuthState(query.state, provider)) throw new HttpError(400, 'OAUTH_FAILED', '第三方授权未完成，请重试');
      const user = authenticateOAuthUser(db, provider, await exchangeOAuthProfile(provider, query.code, request));
      const token = sessionToken(); db.createSession(user.id, token, sessionExpiry());
      reply.header('Set-Cookie', [clearCookie(oauthCookieName(provider)), cookie(sessionCookieName(), token)]).redirect(appHomePath());
    } catch (error) {
      app.log.warn({ err: error, provider }, 'oauth callback failed');
      const authError = isOAuthNetworkError(error) ? 'oauth_network_error' : 'oauth_failed';
      reply.header('Set-Cookie', clearCookie(oauthCookieName(provider))).redirect(`${appHomePath()}?authError=${authError}`);
    }
  });
  app.get('/api/bootstrap', async (request) => {
    const user = authUser(request);
    if (user && normalizeEmail(process.env.LEGACY_VOCABULARY_OWNER_EMAIL || '') === user.email) db.claimLegacyVocabulary(user.id);
    const courses = db.listCourses(); const vocabulary = user ? db.listVocabulary(user.id) : []; const settings = db.getSettings();
    const statsRows = db.db.prepare('SELECT * FROM study_progress').all() as any[];
    const stats = { playbackSeconds: statsRows.reduce((sum, row) => sum + row.playback_seconds, 0), sessionSeconds: statsRows.reduce((sum, row) => sum + row.session_seconds, 0), learnedLessons: statsRows.filter((row) => JSON.parse(row.completed_cue_ids).length > 0).length };
    return { user, courses, vocabulary, settings, stats, migrationVersion: 4 };
  });

  app.post('/api/lessons/resolve', async (request, reply) => {
    const input = resolveLessonSchema.parse(request.body);
    const result = await resolveAndSave(input.sourceUrl, input.title, input.lessonId);
    reply.send(result);
  });
  app.get('/api/lessons/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = hydrate(id); if (!result) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '课时不存在' } });
    reply.send(result);
  });
  app.post('/api/lessons/:id/refresh', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const lesson = db.getLesson(id); if (!lesson) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '课时不存在' } });
    reply.send(await resolveAndSave(lesson.sourceUrl, lesson.title, id));
  });
  app.patch('/api/lessons/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({ title: z.string().trim().min(1).max(300).optional(), sourceUrl: z.string().url().optional() }).parse(request.body);
    if (!db.updateLesson(id, input)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '课时不存在' } });
    if (input.sourceUrl) reply.send(await resolveAndSave(input.sourceUrl, input.title, id)); else reply.send(hydrate(id));
  });

  app.post('/api/lessons/:id/translations/:cueId', async (request, reply) => {
    const { id, cueId } = z.object({ id: z.string().uuid(), cueId: z.string().min(1).max(120) }).parse(request.params);
    await translateCue(db, id, cueId);
    reply.send(hydrate(id));
  });
  app.get('/api/jobs/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const job = db.getJob(id); if (!job) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '任务不存在' } });
    reply.send(job);
  });

  app.post('/api/courses', async (request, reply) => reply.code(201).send(db.createCourse(createCourseSchema.parse(request.body).name)));
  app.patch('/api/courses/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params); const { name } = updateCourseSchema.parse(request.body);
    if (!name || !db.updateCourse(id, name)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '课程不存在' } });
    reply.send({ ok: true });
  });
  app.delete('/api/courses/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    if (!db.deleteCourse(id)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '课程不存在' } });
    reply.code(204).send();
  });
  app.post('/api/courses/:id/lessons', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params); const input = addLessonSchema.parse(request.body);
    const result = input.lessonId ? hydrate(input.lessonId) : await resolveAndSave(input.sourceUrl, input.title);
    if (!result) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '课时不存在' } });
    db.addLessonToCourse(id, result.lesson.id); reply.code(201).send(hydrate(result.lesson.id));
  });
  app.delete('/api/courses/:courseId/lessons/:lessonId', async (request, reply) => {
    const { courseId, lessonId } = z.object({ courseId: z.string().min(1), lessonId: z.string().uuid() }).parse(request.params);
    db.removeLessonFromCourse(courseId, lessonId); reply.code(204).send();
  });
  app.put('/api/courses/:id/order', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params); const { lessonIds } = reorderSchema.parse(request.body);
    db.reorderLessons(id, lessonIds); reply.send({ ok: true });
  });

  app.patch('/api/lessons/:id/progress', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const input = progressSchema.parse(request.body);
    if (!db.getLesson(id)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '课时不存在' } });
    db.saveProgress(id, input); reply.send(db.getProgress(id));
  });
  app.patch('/api/settings', async (request) => { const values = settingsSchema.parse(request.body); db.saveSettings(values); return db.getSettings(); });
  app.get('/api/vocabulary', async (request) => db.listVocabulary(requireUser(request).id));
  app.post('/api/vocabulary/toggle', async (request) => { const user = requireUser(request); const input = vocabularySchema.parse(request.body); return { saved: db.toggleVocabulary(input.word, input.lessonId, input.cueId, user.id), vocabulary: db.listVocabulary(user.id) }; });
  app.post('/api/vocabulary/sync', async (request) => { const user = requireUser(request); return { vocabulary: db.syncUserVocabulary(user.id, vocabularySyncSchema.parse(request.body).items) }; });
  app.get('/api/phrases', async (request) => db.listVocabulary(requireUser(request).id).filter((item) => item.kind === 'phrase'));
  app.post('/api/phrases', async (request) => { const user = requireUser(request); const input = phraseSchema.parse(request.body); const result = db.addPhrase(input.phrase, input.meaning, input.note, input.example, input.lessonId, input.cueId, user.id); return { ...result, vocabulary: db.listVocabulary(user.id) }; });
  app.patch('/api/phrases/:text', async (request, reply) => { const user = requireUser(request); const { text } = z.object({ text: z.string().min(2).max(160) }).parse(request.params); const input = phraseUpdateSchema.parse(request.body); const result = db.updatePhrase(text, input.phrase, input.meaning, input.note, input.example, user.id); if (result === 'not_found') return reply.code(404).send({ error: { code: 'PHRASE_NOT_FOUND', message: '短语不存在' } }); if (result === 'duplicate') return reply.code(409).send({ error: { code: 'PHRASE_EXISTS', message: '短语已存在' } }); return { ok: true, vocabulary: db.listVocabulary(user.id) }; });
  app.delete('/api/phrases/:text', async (request, reply) => { const user = requireUser(request); const { text } = z.object({ text: z.string().min(2).max(160) }).parse(request.params); if (!db.removePhrase(text, user.id)) return reply.code(404).send({ error: { code: 'PHRASE_NOT_FOUND', message: '短语不存在' } }); reply.send({ ok: true, vocabulary: db.listVocabulary(user.id) }); });
  app.post('/api/review/:group', async (request) => { const user = requireUser(request); const { group } = z.object({ group: z.coerce.number().int().min(0) }).parse(request.params); const input = z.object({ items: z.array(z.object({ word: z.string().min(1), kind: z.string().optional() })).max(10).optional(), words: z.array(z.string()).max(10).optional() }).parse(request.body); const items = input.items || (input.words || []).map((word) => ({ word, kind: 'word' })); db.recordReview(group, items, user.id); return { ok: true, vocabulary: db.listVocabulary(user.id) }; });
  app.get('/api/dictionary/:word', async (request, reply) => {
    const { word } = z.object({ word: z.string().min(1).max(80) }).parse(request.params);
    try { reply.send(await lookupWord(db, word)); } catch (error) { reply.code(404).send({ error: { code: 'WORD_NOT_FOUND', message: errorMessage(error) } }); }
  });
  app.get('/api/dictionary/search', async (request, reply) => {
    const { q, direction } = z.object({ q: z.string().trim().min(1).max(80), direction: z.enum(['en-zh', 'zh-en']) }).parse(request.query);
    try { reply.send(searchDictionary(q, direction)); }
    catch (error) { reply.code(503).send({ error: { code: 'DICTIONARY_UNAVAILABLE', message: errorMessage(error) } }); }
  });

  app.get('/api/export', async (request, reply) => reply.header('Content-Disposition', `attachment; filename="echoline-${new Date().toISOString().slice(0,10)}.json"`).send(db.exportData(requireUser(request).id)));
  app.post('/api/import', async (request) => {
    const user = requireUser(request);
    const input = z.object({ version: z.union([z.literal(1), z.literal(2)]), courses: z.array(z.any()), progress: z.array(z.any()).default([]), vocabulary: z.array(z.any()).default([]), settings: z.record(z.any()).default({}) }).parse(request.body);
    const lessonMap = new Map<string, string>();
    for (const importedCourse of input.courses) {
      if (!importedCourse?.name) continue;
      let course = db.listCourses().find((item) => item.name === importedCourse.name);
      if (!course) course = db.createCourse(importedCourse.name);
      for (const importedLesson of Array.isArray(importedCourse.lessons) ? importedCourse.lessons : []) {
        if (!importedLesson?.sourceUrl) continue;
        const lesson = db.upsertPendingLesson(importedLesson.sourceUrl, importedLesson.title);
        db.addLessonToCourse(course.id, lesson.id); lessonMap.set(importedLesson.id, lesson.id);
      }
    }
    for (const item of input.progress) { const lessonId = lessonMap.get(item.lessonId); if (lessonId) db.saveProgress(lessonId, item); }
    const existingWords = new Set(db.listVocabulary(user.id).map((item) => item.word));
    for (const item of input.vocabulary) {
      if (!item?.word || existingWords.has(item.word)) continue;
      if (item.kind === 'phrase' && item.meaning) db.addPhrase(item.text || item.word, item.meaning, item.note, item.example, lessonMap.get(item.lessonId) || null, item.cueId, user.id);
      else db.toggleVocabulary(item.word, lessonMap.get(item.lessonId) || null, item.cueId, user.id);
    }
    db.saveSettings(input.settings);
    return { ok: true, importedCourses: input.courses.length, pendingResolution: lessonMap.size };
  });
  app.post('/api/migrate/local-storage', async (request) => {
    const input = z.object({ courses: z.array(z.any()).default([]), vocabulary: z.array(z.string()).default([]), stats: z.any().optional(), settings: z.record(z.any()).default({}) }).parse(request.body);
    const existingNames = new Set(db.listCourses().map((course) => course.name));
    for (const oldCourse of input.courses) {
      if (!oldCourse || typeof oldCourse.name !== 'string') continue;
      const course = oldCourse.id === 'ai-prompting' ? db.listCourses().find((item) => item.id === 'ai-prompting') : (existingNames.has(oldCourse.name) ? db.listCourses().find((item) => item.name === oldCourse.name) : db.createCourse(oldCourse.name));
      for (const item of Array.isArray(oldCourse.items) ? oldCourse.items : []) {
        if (!item?.url) continue;
        try { const lesson = db.upsertPendingLesson(item.url, item.title); db.addLessonToCourse(course!.id, lesson.id); const oldStats = input.stats?.videos?.[item.canonicalUrl || item.url]; if (oldStats) db.saveProgress(lesson.id, { playbackSeconds: oldStats.studiedSeconds || 0, sessionSeconds: oldStats.studiedSeconds || 0 }); } catch { /* retain other valid legacy records */ }
      }
    }
    for (const word of input.vocabulary) db.toggleVocabulary(word);
    db.saveSettings({ ...input.settings, localStorageMigrated: true });
    return { ok: true };
  });

  app.post('/api/cache/clear', async () => { db.db.exec('DELETE FROM dictionary_cache; DELETE FROM translations; UPDATE lessons SET translation_status=\'idle\', translation_progress=0;'); return { ok: true }; });

  if (options.production) {
    await app.register(fastifyStatic, { root: resolve('dist'), wildcard: false });
    app.setNotFoundHandler((request, reply) => request.raw.url?.startsWith('/api/')
      ? reply.code(404).send({ error: { code: 'NOT_FOUND', message: '接口不存在' } })
      : reply.sendFile('index.html'));
  }
  app.addHook('onClose', async () => { if (!options.database) db.close(); });
  return app;
}

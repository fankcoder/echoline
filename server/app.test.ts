import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { EchoDatabase } from './db.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close(); app = undefined;
  delete process.env.PUBLIC_ORIGIN; delete process.env.APP_BASE_PATH;
  delete process.env.GITHUB_CLIENT_ID; delete process.env.GITHUB_CLIENT_SECRET;
  delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.LEGACY_VOCABULARY_OWNER_EMAIL;
  vi.restoreAllMocks();
});

function sessionCookie(response: { headers: Record<string, string | string[] | number | undefined> }) {
  const value = response.headers['set-cookie'];
  const cookie = Array.isArray(value) ? value[0] : value;
  if (!cookie || typeof cookie !== 'string') throw new Error('登录响应没有会话 Cookie');
  return cookie.split(';', 1)[0];
}

async function register(email: string, password = 'password-123') {
  const response = await app!.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password, displayName: email.split('@')[0] } });
  expect(response.statusCode).toBe(201);
  return { response, cookie: sessionCookie(response) };
}

describe('local production API', () => {
  it('returns a versioned bootstrap document', async () => {
    app = await buildApp({ database: new EchoDatabase(':memory:') });
    const response = await app.inject({ method: 'GET', url: '/api/bootstrap' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ migrationVersion: 4, user: null, vocabulary: [], courses: [{ id: 'ai-prompting' }] });
  });

  it('supports course CRUD and stable lesson membership', async () => {
    const db = new EchoDatabase(':memory:'); app = await buildApp({ database: db });
    const created = await app.inject({ method: 'POST', url: '/api/courses', payload: { name: 'New course' } });
    const courseId = created.json().id; const lessonId = db.upsertPendingLesson('https://learn.deeplearning.ai/course/lesson/test').id;
    expect((await app.inject({ method: 'POST', url: `/api/courses/${courseId}/lessons`, payload: { sourceUrl: 'https://learn.deeplearning.ai/course/lesson/test', lessonId } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'PATCH', url: `/api/courses/${courseId}`, payload: { name: 'Renamed' } })).statusCode).toBe(200);
    expect(db.listCourses().find((course) => course.id === courseId)?.lessons[0].id).toBe(lessonId);
  });

  it('blocks untrusted browser origins', async () => {
    app = await buildApp({ database: new EchoDatabase(':memory:') });
    const response = await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { origin: 'https://attacker.example' } });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('ORIGIN_REJECTED');
  });

  it('allows an explicitly configured public origin', async () => {
    process.env.PUBLIC_ORIGIN = 'https://anhao.net';
    app = await buildApp({ database: new EchoDatabase(':memory:') });
    const response = await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { origin: 'https://anhao.net' } });
    expect(response.statusCode).toBe(200);
  });

  it('builds a GitHub OAuth redirect using the public base path', async () => {
    process.env.PUBLIC_ORIGIN = 'https://anhao.net'; process.env.APP_BASE_PATH = '/learn';
    process.env.GITHUB_CLIENT_ID = 'github-client'; process.env.GITHUB_CLIENT_SECRET = 'github-secret';
    app = await buildApp({ database: new EchoDatabase(':memory:') });
    const response = await app.inject({ method: 'GET', url: '/api/auth/github/start' });
    expect(response.statusCode).toBe(302);
    const redirect = new URL(String(response.headers.location));
    expect(redirect.origin).toBe('https://github.com');
    expect(redirect.searchParams.get('redirect_uri')).toBe('https://anhao.net/learn/api/auth/github/callback');
    expect(redirect.searchParams.get('state')).toBeTruthy();
    expect(sessionCookie(response)).toContain('echoline_oauth_github=');
  });

  it('returns to the app when a third-party login is not configured', async () => {
    app = await buildApp({ database: new EchoDatabase(':memory:') });
    const response = await app.inject({ method: 'GET', url: '/api/auth/google/start' });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/?authError=oauth_not_configured');
  });

  it('reports a third-party network failure without creating a session', async () => {
    process.env.PUBLIC_ORIGIN = 'https://anhao.net'; process.env.APP_BASE_PATH = '/learn';
    process.env.GITHUB_CLIENT_ID = 'github-client'; process.env.GITHUB_CLIENT_SECRET = 'github-secret';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed: Connect Timeout Error'));
    app = await buildApp({ database: new EchoDatabase(':memory:') });
    const started = await app.inject({ method: 'GET', url: '/api/auth/github/start' });
    const state = new URL(String(started.headers.location)).searchParams.get('state');
    const callback = await app.inject({ method: 'GET', url: `/api/auth/github/callback?code=temporary-code&state=${state}`, headers: { cookie: sessionCookie(started) } });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('/learn/?authError=oauth_network_error');
    expect((await app.inject({ method: 'GET', url: '/api/auth/me' })).json()).toEqual({ user: null });
  });

  it('validates dictionary search direction before querying the local database', async () => {
    app = await buildApp({ database: new EchoDatabase(':memory:') });
    const response = await app.inject({ method: 'GET', url: '/api/dictionary/search?q=frontier&direction=invalid' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns a cached translation for only the requested cue', async () => {
    const db = new EchoDatabase(':memory:'); app = await buildApp({ database: db });
    const lesson = db.upsertPendingLesson('https://learn.deeplearning.ai/course/lesson/on-demand');
    db.saveResolvedLesson({ id: lesson.id, sourceUrl: lesson.sourceUrl, title: 'On demand', hash: 'cue-hash', cues: [
      { id: 'cue-1', start: 0, end: 1, en: 'First sentence.' },
      { id: 'cue-2', start: 1, end: 2, en: 'Second sentence.' },
    ] });
    db.saveTranslations(lesson.id, 'cue-hash', [{ id: 'cue-1', text: '第一句。' }], 'test', 'test', 'v1');

    const response = await app.inject({ method: 'POST', url: `/api/lessons/${lesson.id}/translations/cue-1` });
    expect(response.statusCode).toBe(200);
    expect(response.json().cues).toEqual([
      expect.objectContaining({ id: 'cue-1', zh: '第一句。' }),
      expect.objectContaining({ id: 'cue-2', zh: null }),
    ]);
  });

  it('requires login before writing cloud vocabulary', async () => {
    app = await buildApp({ database: new EchoDatabase(':memory:') });
    const response = await app.inject({ method: 'POST', url: '/api/vocabulary/toggle', payload: { word: 'frontier' } });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('AUTH_REQUIRED');
  });

  it('creates a session and keeps each user vocabulary isolated', async () => {
    const db = new EchoDatabase(':memory:'); app = await buildApp({ database: db });
    const lessonId = db.upsertPendingLesson('https://learn.deeplearning.ai/course/lesson/phrase').id;
    const alice = await register('alice@example.com');
    const created = await app.inject({ method: 'POST', url: '/api/phrases', headers: { cookie: alice.cookie }, payload: { phrase: 'at   the cutting edge', meaning: '处于前沿', lessonId, cueId: 'cue-1' } });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ saved: true, item: { kind: 'phrase', text: 'at the cutting edge', meaning: '处于前沿' } });
    const duplicate = await app.inject({ method: 'POST', url: '/api/phrases', headers: { cookie: alice.cookie }, payload: { phrase: 'AT THE CUTTING EDGE', meaning: '最先进' } });
    expect(duplicate.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/vocabulary/toggle', headers: { cookie: alice.cookie }, payload: { word: 'frontier', lessonId, cueId: 'cue-2' } })).statusCode).toBe(200);
    const review = await app.inject({ method: 'POST', url: '/api/review/0', headers: { cookie: alice.cookie }, payload: { items: [{ word: 'at the cutting edge', kind: 'phrase' }] } });
    expect(review.statusCode).toBe(200);
    expect(review.json().vocabulary[0].reviewCount).toBe(1);
    const updated = await app.inject({ method: 'PATCH', url: '/api/phrases/at%20the%20cutting%20edge', headers: { cookie: alice.cookie }, payload: { phrase: 'on the cutting edge', meaning: '站在前沿' } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().vocabulary[0]).toMatchObject({ word: 'on the cutting edge', meaning: '站在前沿' });
    const bob = await register('bob@example.com');
    expect((await app.inject({ method: 'GET', url: '/api/vocabulary', headers: { cookie: bob.cookie } })).json()).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/api/phrases', headers: { cookie: alice.cookie } })).json()).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: '/api/phrases/on%20the%20cutting%20edge', headers: { cookie: alice.cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/phrases', headers: { cookie: alice.cookie } })).json()).toHaveLength(0);
  });

  it('logs in by email and merges local vocabulary without overwriting cloud items', async () => {
    app = await buildApp({ database: new EchoDatabase(':memory:') });
    const registered = await register('sync@example.com');
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'sync@example.com', password: 'password-123' } });
    expect(login.statusCode).toBe(200);
    const cookie = sessionCookie(login);
    expect(login.json().user).toMatchObject({ email: 'sync@example.com' });
    expect((await app.inject({ method: 'POST', url: '/api/vocabulary/toggle', headers: { cookie: registered.cookie }, payload: { word: 'existing' } })).statusCode).toBe(200);
    const synced = await app.inject({ method: 'POST', url: '/api/vocabulary/sync', headers: { cookie }, payload: { items: [
      { word: 'resilient', text: 'resilient', kind: 'word', addedAt: 1, reviewCount: 2 },
      { word: 'at the cutting edge', text: 'at the cutting edge', kind: 'phrase', meaning: '处于前沿', addedAt: 2 },
    ] } });
    expect(synced.statusCode).toBe(200);
    expect(synced.json().vocabulary).toEqual(expect.arrayContaining([
      expect.objectContaining({ word: 'existing' }),
      expect.objectContaining({ word: 'resilient', reviewCount: 2 }),
      expect.objectContaining({ word: 'at the cutting edge', kind: 'phrase', meaning: '处于前沿' }),
    ]));
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/vocabulary', headers: { cookie } })).statusCode).toBe(401);
  });

  it('exports and migrates vocabulary only for the authenticated owner', async () => {
    const db = new EchoDatabase(':memory:'); db.toggleVocabulary('legacy-word');
    process.env.LEGACY_VOCABULARY_OWNER_EMAIL = 'owner@example.com';
    app = await buildApp({ database: db });
    expect((await app.inject({ method: 'GET', url: '/api/export' })).statusCode).toBe(401);
    const owner = await register('owner@example.com');
    const bootstrapped = await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { cookie: owner.cookie } });
    expect(bootstrapped.json().vocabulary).toEqual([expect.objectContaining({ word: 'legacy-word' })]);
    const exported = await app.inject({ method: 'GET', url: '/api/export', headers: { cookie: owner.cookie } });
    expect(exported.json().vocabulary).toEqual([expect.objectContaining({ word: 'legacy-word' })]);
    const other = await register('other@example.com');
    expect((await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { cookie: other.cookie } })).json().vocabulary).toEqual([]);
  });
});

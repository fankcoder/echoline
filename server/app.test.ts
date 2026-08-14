import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { EchoDatabase } from './db.js';

let app: FastifyInstance | undefined;
afterEach(async () => { await app?.close(); app = undefined; delete process.env.PUBLIC_ORIGIN; });

describe('local production API', () => {
  it('returns a versioned bootstrap document', async () => {
    app = await buildApp({ database: new EchoDatabase(':memory:') });
    const response = await app.inject({ method: 'GET', url: '/api/bootstrap' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ migrationVersion: 2, courses: [{ id: 'ai-prompting' }] });
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

  it('creates, deduplicates, and reviews phrases with vocabulary items', async () => {
    const db = new EchoDatabase(':memory:'); app = await buildApp({ database: db });
    const lessonId = db.upsertPendingLesson('https://learn.deeplearning.ai/course/lesson/phrase').id;
    const created = await app.inject({ method: 'POST', url: '/api/phrases', payload: { phrase: 'at   the cutting edge', meaning: '处于前沿', lessonId, cueId: 'cue-1' } });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ saved: true, item: { kind: 'phrase', text: 'at the cutting edge', meaning: '处于前沿' } });
    const duplicate = await app.inject({ method: 'POST', url: '/api/phrases', payload: { phrase: 'AT THE CUTTING EDGE', meaning: '最先进' } });
    expect(duplicate.statusCode).toBe(200);
    expect(db.listVocabulary()).toHaveLength(1);
    const review = await app.inject({ method: 'POST', url: '/api/review/0', payload: { items: [{ word: 'at the cutting edge', kind: 'phrase' }] } });
    expect(review.statusCode).toBe(200);
    expect(review.json().vocabulary[0].reviewCount).toBe(1);
    const updated = await app.inject({ method: 'PATCH', url: '/api/phrases/at%20the%20cutting%20edge', payload: { phrase: 'on the cutting edge', meaning: '站在前沿' } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().vocabulary[0]).toMatchObject({ word: 'on the cutting edge', meaning: '站在前沿' });
    expect((await app.inject({ method: 'GET', url: '/api/phrases' })).json()).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: '/api/phrases/on%20the%20cutting%20edge' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/phrases' })).json()).toHaveLength(0);
  });
});

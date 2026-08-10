import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { EchoDatabase } from './db.js';

let app: FastifyInstance | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

describe('local production API', () => {
  it('returns a versioned bootstrap document', async () => {
    app = await buildApp({ database: new EchoDatabase(':memory:') });
    const response = await app.inject({ method: 'GET', url: '/api/bootstrap' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ migrationVersion: 1, courses: [{ id: 'ai-prompting' }] });
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
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { EchoDatabase } from './db.js';
import { __testing, translateCue } from './translation.js';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TRANSLATION_PROVIDER;
  delete process.env.TRANSLATION_REQUEST_INTERVAL_MS;
});

describe('free sentence translation', () => {
  it('parses MyMemory and LibreTranslate responses', () => {
    expect(__testing.parseMyMemory({ responseStatus: 200, responseData: { translatedText: '人工智能&amp;机器学习' } })).toBe('人工智能&机器学习');
    expect(__testing.parseLibre({ translatedText: '技术课程' })).toBe('技术课程');
  });

  it('reports exhausted MyMemory quota', () => {
    expect(() => __testing.parseMyMemory({ responseStatus: 403, quotaFinished: true, responseDetails: 'DAILY LIMIT', responseData: { translatedText: '' } })).toThrow('DAILY LIMIT');
  });

  it('translates and caches only the selected cue without an API key', async () => {
    process.env.TRANSLATION_PROVIDER = 'mymemory'; process.env.TRANSLATION_REQUEST_INTERVAL_MS = '0';
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: '第一句。' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', request);
    const db = new EchoDatabase(':memory:');
    const lesson = db.upsertPendingLesson('https://learn.deeplearning.ai/course/lesson/free-translation');
    db.saveResolvedLesson({ id: lesson.id, sourceUrl: lesson.sourceUrl, title: 'Free', hash: 'free-hash', cues: [
      { id: 'cue-1', start: 0, end: 1, en: 'First sentence.' },
      { id: 'cue-2', start: 1, end: 2, en: 'Second sentence.' },
    ] });

    await expect(translateCue(db, lesson.id, 'cue-1')).resolves.toEqual({ id: 'cue-1', text: '第一句。' });
    await expect(translateCue(db, lesson.id, 'cue-1')).resolves.toEqual({ id: 'cue-1', text: '第一句。' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(db.getCues(lesson.id).cues).toEqual([
      expect.objectContaining({ id: 'cue-1', zh: '第一句。' }),
      expect.objectContaining({ id: 'cue-2', zh: null }),
    ]);
    db.close();
  });
});

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EchoDatabase, canonicalizeUrl } from './db.js';

describe('EchoDatabase', () => {
  it('keeps stable lesson identity and deduplicates course membership', () => {
    const db = new EchoDatabase(':memory:');
    const lesson = db.upsertPendingLesson('https://learn.deeplearning.ai/course/lesson/demo?tracking=x', 'Demo');
    const same = db.upsertPendingLesson('https://learn.deeplearning.ai/course/lesson/demo?other=y', 'Changed');
    expect(same.id).toBe(lesson.id);
    db.addLessonToCourse('ai-prompting', lesson.id); db.addLessonToCourse('ai-prompting', lesson.id);
    expect(db.listCourses()[0].lessons).toHaveLength(1);
    db.close();
  });

  it('stores each lesson captions and translations independently', () => {
    const db = new EchoDatabase(':memory:');
    const first = db.upsertPendingLesson('https://learn.deeplearning.ai/course/lesson/one');
    const second = db.upsertPendingLesson('https://learn.deeplearning.ai/course/lesson/two');
    db.saveResolvedLesson({ id: first.id, sourceUrl: first.sourceUrl, title: 'One', cues: [{ id: 'cue-1', start: 0, end: 1, en: 'First sentence' }], hash: 'hash-one' });
    db.saveResolvedLesson({ id: second.id, sourceUrl: second.sourceUrl, title: 'Two', cues: [{ id: 'cue-1', start: 0, end: 1, en: 'Second sentence' }], hash: 'hash-two' });
    db.saveTranslations(first.id, 'hash-one', [{ id: 'cue-1', text: '第一句' }], 'test', 'test', 'v1');
    expect(db.getCues(first.id).cues[0]).toMatchObject({ en: 'First sentence', zh: '第一句' });
    expect(db.getCues(second.id).cues[0]).toMatchObject({ en: 'Second sentence', zh: null });
    db.close();
  });

  it('reorders memberships without changing lesson IDs', () => {
    const db = new EchoDatabase(':memory:');
    const ids = [0, 1, 2].map((index) => db.upsertPendingLesson(`https://learn.deeplearning.ai/course/lesson/${index}`, `L${index}`).id);
    ids.forEach((id) => db.addLessonToCourse('ai-prompting', id)); db.reorderLessons('ai-prompting', [ids[2], ids[0], ids[1]]);
    expect(db.listCourses()[0].lessons.map((lesson) => lesson.id)).toEqual([ids[2], ids[0], ids[1]]);
    db.close();
  });

  it('normalizes tracking parameters', () => {
    expect(canonicalizeUrl('https://example.com/a/?x=1#top')).toBe('https://example.com/a');
    expect(randomUUID()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('persists the study mode repeat count', () => {
    const db = new EchoDatabase(':memory:');
    expect(db.getSettings().repeatCount).toBe(1);
    db.saveSettings({ repeatCount: 9 });
    expect(db.getSettings().repeatCount).toBe(9);
    db.close();
  });
});

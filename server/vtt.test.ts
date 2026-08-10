import { describe, expect, it } from 'vitest';
import { captionHash, parseTimestamp, parseVtt } from './vtt.js';

describe('VTT parser', () => {
  it('parses hour and minute timestamps and strips markup', () => {
    const cues = parseVtt(`WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\nHello <b>world</b>.\n\n00:03.000 --> 00:04.000 align:start\nNext line`);
    expect(cues).toEqual([
      { id: 'cue-1', start: 1, end: 2.5, en: 'Hello world.' },
      { id: 'cue-2', start: 3, end: 4, en: 'Next line' },
    ]);
    expect(parseTimestamp('01:02.500')).toBe(62.5);
  });

  it('creates a stable hash that changes with source text', () => {
    const a = parseVtt('WEBVTT\n\n00:00.000 --> 00:01.000\nA');
    const b = parseVtt('WEBVTT\n\n00:00.000 --> 00:01.000\nB');
    expect(captionHash(a)).toBe(captionHash(a));
    expect(captionHash(a)).not.toBe(captionHash(b));
  });

  it('reassembles time-sliced captions into complete sentences', () => {
    const cues = parseVtt(`WEBVTT

00:00:00.000 --> 00:00:04.000
AI systems have learned patterns from reading large amounts of text

00:00:04.000 --> 00:00:08.000
from the internet. By understanding what is in that text,

00:00:08.000 --> 00:00:12.000
you can predict how they will behave.`);

    expect(cues.map((cue) => cue.en)).toEqual([
      'AI systems have learned patterns from reading large amounts of text from the internet.',
      'By understanding what is in that text, you can predict how they will behave.',
    ]);
    expect(cues[0].start).toBe(0);
    expect(cues[0].end).toBeGreaterThan(4);
    expect(cues[1].start).toBeLessThan(8);
    expect(cues[1].end).toBe(12);
  });

  it('does not merge captions across a long pause', () => {
    const cues = parseVtt(`WEBVTT

00:00:00.000 --> 00:00:01.000
First fragment

00:00:03.000 --> 00:00:04.000
Second fragment`);
    expect(cues.map((cue) => cue.en)).toEqual(['First fragment', 'Second fragment']);
  });
});

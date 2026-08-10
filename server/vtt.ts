import { createHash } from 'node:crypto';
import type { Cue } from './types.js';

type CaptionCue = Omit<Cue, 'zh'>;
type TextSpan = { cue: CaptionCue; startIndex: number; endIndex: number };

export function parseTimestamp(value: string): number {
  const clean = value.trim().replace(',', '.');
  const parts = clean.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) throw new Error(`无效字幕时间：${value}`);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  throw new Error(`无效字幕时间：${value}`);
}

function decodeText(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"').replace(/&#(?:39|x27);/gi, "'").replace(/\s+/g, ' ').trim();
}

export function parseVttCues(source: string): CaptionCue[] {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r/g, '');
  const cues = normalized
    .split(/\n{2,}/)
    .filter((block) => block.includes('-->'))
    .map((block, index) => {
      const lines = block.split('\n').filter(Boolean);
      const timingIndex = lines.findIndex((line) => line.includes('-->'));
      const timing = lines[timingIndex].split('-->');
      const start = parseTimestamp(timing[0]);
      const end = parseTimestamp(timing[1].trim().split(/\s+/)[0]);
      const en = decodeText(lines.slice(timingIndex + 1).join(' '));
      if (!en || end <= start) return null;
      return { id: `source-${index + 1}`, start, end, en };
    })
    .filter((cue): cue is CaptionCue => cue !== null);
  if (!cues.length) throw new Error('英文字幕为空或格式无效');
  return cues;
}

function timeAt(span: TextSpan, index: number): number {
  const length = Math.max(1, span.endIndex - span.startIndex);
  const ratio = Math.max(0, Math.min(1, (index - span.startIndex) / length));
  return span.cue.start + (span.cue.end - span.cue.start) * ratio;
}

function segmentGroup(cues: CaptionCue[], locale: string): CaptionCue[] {
  let transcript = '';
  const spans: TextSpan[] = [];
  for (const cue of cues) {
    if (transcript) transcript += ' ';
    const startIndex = transcript.length;
    transcript += cue.en;
    spans.push({ cue, startIndex, endIndex: transcript.length });
  }
  const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
  const segments = [...segmenter.segment(transcript)];
  return segments.map((segment) => {
    const leading = segment.segment.length - segment.segment.trimStart().length;
    const text = segment.segment.trim();
    const startIndex = segment.index + leading;
    const endIndex = startIndex + text.length;
    const first = spans.find((span) => startIndex < span.endIndex && endIndex > span.startIndex) || spans[0];
    const last = [...spans].reverse().find((span) => startIndex < span.endIndex && endIndex > span.startIndex) || spans.at(-1)!;
    return { id: '', start: timeAt(first, startIndex), end: timeAt(last, endIndex), en: text };
  }).filter((cue) => cue.en && cue.end > cue.start);
}

export function segmentCaptionCues(cues: CaptionCue[], locale = 'en'): CaptionCue[] {
  const groups: CaptionCue[][] = [];
  for (const cue of cues) {
    const current = groups.at(-1);
    if (!current || cue.start - current.at(-1)!.end > 1.75) groups.push([cue]);
    else current.push(cue);
  }
  return groups.flatMap((group) => segmentGroup(group, locale))
    .map((cue, index) => ({ ...cue, id: `cue-${index + 1}` }));
}

export function parseVtt(source: string, locale = 'en'): CaptionCue[] {
  return segmentCaptionCues(parseVttCues(source), locale);
}

export function captionHash(cues: CaptionCue[]): string {
  return createHash('sha256')
    .update(cues.map(({ id, start, end, en }) => `${id}|${start}|${end}|${en}`).join('\n'))
    .digest('hex');
}

export function mergeTranslation(cues: CaptionCue[], translations: Map<string, string>): Cue[] {
  return cues.map((cue) => ({ ...cue, zh: translations.get(cue.id) ?? null }));
}

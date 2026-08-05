import { createHash } from 'node:crypto';
import type { Cue } from './types.js';

export function parseTimestamp(value: string): number {
  const clean = value.trim().replace(',', '.');
  const parts = clean.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) throw new Error(`无效字幕时间：${value}`);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  throw new Error(`无效字幕时间：${value}`);
}

export function parseVtt(source: string): Omit<Cue, 'zh'>[] {
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
      const en = lines.slice(timingIndex + 1).join(' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      if (!en || end <= start) return null;
      return { id: `cue-${index + 1}`, start, end, en };
    })
    .filter((cue): cue is Omit<Cue, 'zh'> => cue !== null);
  if (!cues.length) throw new Error('英文字幕为空或格式无效');
  return cues;
}

export function captionHash(cues: Omit<Cue, 'zh'>[]): string {
  return createHash('sha256')
    .update(cues.map(({ id, start, end, en }) => `${id}|${start}|${end}|${en}`).join('\n'))
    .digest('hex');
}

export function mergeTranslation(cues: Omit<Cue, 'zh'>[], translations: Map<string, string>): Cue[] {
  return cues.map((cue) => ({ ...cue, zh: translations.get(cue.id) ?? null }));
}

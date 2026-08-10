import { describe, expect, it } from 'vitest';
import { normalizeRepeatCount, phaseAfterCue } from './studyMode';

describe('study mode repetitions', () => {
  it('normalizes repetition settings to zero through nine', () => {
    expect(normalizeRepeatCount(undefined)).toBe(1);
    expect(normalizeRepeatCount(-2)).toBe(0);
    expect(normalizeRepeatCount(4.6)).toBe(5);
    expect(normalizeRepeatCount(20)).toBe(9);
  });

  it('stops immediately at zero and after the configured repeats', () => {
    expect(phaseAfterCue('listening', 0, 0)).toBe('ready');
    expect(phaseAfterCue('listening', 0, 3)).toBe('pause');
    expect(phaseAfterCue('repeat', 1, 3)).toBe('pause');
    expect(phaseAfterCue('repeat', 3, 3)).toBe('ready');
  });
});

import { describe, expect, it } from 'vitest';
import { __testing } from './dictionary.js';

describe('ECDICT normalization', () => {
  it('turns escaped dictionary lines into readable Chinese definitions', () => {
    expect(__testing.cleanField('n. 技术\\nv. 训练')).toBe('n. 技术；v. 训练');
  });

  it('creates common English inflection candidates', () => {
    expect(__testing.wordCandidates('models')).toContain('model');
    expect(__testing.wordCandidates('studies')).toContain('study');
    expect(__testing.wordCandidates('running')).toContain('run');
  });

  it('escapes SQL LIKE control characters in a lookup term', () => {
    expect(__testing.escapeLike('100%_sure\\ok')).toBe('100\\%\\_sure\\\\ok');
  });
});

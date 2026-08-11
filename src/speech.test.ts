import { describe, expect, it, vi } from 'vitest';
import { getBrowserSpeechAdapter, speakEnglish, type SpeechSynthesisAdapter } from './speech';

function createAdapter() {
  const cancel = vi.fn(); const speak = vi.fn();
  const utterance = { lang: '', rate: 0, onend: null, onerror: null } as unknown as SpeechSynthesisUtterance;
  const adapter: SpeechSynthesisAdapter = { cancel, speak, createUtterance: vi.fn(() => utterance) };
  return { adapter, cancel, speak, utterance };
}

describe('system speech', () => {
  it('uses an English utterance and replaces current speech', () => {
    const { adapter, cancel, speak, utterance } = createAdapter();
    const result = speakEnglish('cutting edge', adapter);
    expect(result).toBe(utterance);
    expect(utterance.lang).toBe('en-US');
    expect(utterance.rate).toBe(1);
    expect(cancel).toHaveBeenCalledBefore(speak);
    expect(speak).toHaveBeenCalledWith(utterance);
  });

  it('reports completion and failures through callbacks', () => {
    const { adapter, utterance } = createAdapter(); const finish = vi.fn(); const failure = vi.fn();
    speakEnglish('frontier', adapter, finish, failure);
    utterance.onend?.(new Event('end') as SpeechSynthesisEvent);
    utterance.onerror?.(new Event('error') as SpeechSynthesisErrorEvent);
    expect(finish).toHaveBeenCalledOnce();
    expect(failure).toHaveBeenCalledOnce();
  });

  it('does not create an utterance for blank text or server-side rendering', () => {
    const { adapter } = createAdapter();
    expect(speakEnglish('  ', adapter)).toBeNull();
    expect(getBrowserSpeechAdapter()).toBeNull();
  });
});

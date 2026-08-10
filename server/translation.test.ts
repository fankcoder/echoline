import { describe, expect, it } from 'vitest';
import { __testing } from './translation.js';

describe('translation protocol compatibility', () => {
  it('prefers Responses for GPT-5 family models', () => {
    expect(__testing.protocols('gpt-5.5', 'auto')).toEqual(['responses', 'chat-completions']);
    expect(__testing.protocols('gpt-4.1-mini', 'auto')).toEqual(['chat-completions', 'responses']);
    expect(__testing.protocols('custom-model', 'responses')).toEqual(['responses']);
  });

  it('extracts text from Chat Completions and Responses payloads', () => {
    expect(__testing.responseText('chat-completions', { choices: [{ message: { content: '[{"id":"cue-1","text":"你好"}]' } }] })).toContain('你好');
    expect(__testing.responseText('responses', { output: [{ type: 'message', content: [{ type: 'output_text', text: '[{"id":"cue-1","text":"你好"}]' }] }] })).toContain('你好');
  });

  it('recognizes provider protocol errors and keeps their useful message', () => {
    const error = __testing.apiError(400, 'chat-completions', JSON.stringify({ error: { code: 'protocol_not_supported', message: '模型不支持 chat completions 协议' } }));
    expect(__testing.unsupportedProtocol(error)).toBe(true);
    expect(error.message).toContain('模型不支持 chat completions 协议');
  });

  it('splits an unusually long cue at clause boundaries for fallback translation', () => {
    const parts = __testing.splitLongCue({ id: 'cue-1', en: 'First long clause with context and several technical details, second clause with substantially more background information, and a final clause that completes the sentence for the learner.' });
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((part) => part.id)).toEqual(parts.map((_, index) => `cue-1__part_${index + 1}`));
    expect(parts.map((part) => part.en).join(' ')).toContain('final clause');
  });
});

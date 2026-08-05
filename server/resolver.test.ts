import { describe, expect, it } from 'vitest';
import { __testing } from './resolver.js';

describe('DeepLearning lesson parser helpers', () => {
  it('decodes embedded URLs and extracts unique tracks', () => {
    const html = __testing.decodeEmbeddedHtml('https:\\/\\/video.deeplearning.ai\\/a-master.m3u8?x=1\\u0026y=2');
    expect(__testing.uniqueUrls(html, 'm3u8')).toEqual(['https://video.deeplearning.ai/a-master.m3u8?x=1&y=2']);
  });

  it('picks English and Chinese tracks independently', () => {
    const tracks = ['https://video.deeplearning.ai/x/subtitle/eng/a-eng.vtt', 'https://video.deeplearning.ai/x/subtitle/zho/a-zho.vtt'];
    expect(__testing.pickTrack(tracks, 'en')).toContain('/eng/');
    expect(__testing.pickTrack(tracks, 'zh')).toContain('/zho/');
  });

  it('reads the selected lesson title instead of the course title', () => {
    const html = '<title>Course name - DeepLearning.AI</title>"abc123":{"index":2,"slug":"abc123","name":"Pretrained knowledge","type":"video"}';
    expect(__testing.pageTitle(html, 'https://learn.deeplearning.ai/courses/x/lesson/abc123/slug')).toBe('Pretrained knowledge');
  });

  it('rejects private network addresses', () => {
    expect(__testing.isPrivateAddress('127.0.0.1')).toBe(true);
    expect(__testing.isPrivateAddress('192.168.1.4')).toBe(true);
    expect(__testing.isPrivateAddress('8.8.8.8')).toBe(false);
  });
});

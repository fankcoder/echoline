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

  it('recognizes supported YouTube URL forms', () => {
    expect(__testing.youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share')).toBe('dQw4w9WgXcQ');
    expect(__testing.youtubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=42')).toBe('dQw4w9WgXcQ');
    expect(__testing.youtubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('reads public YouTube metadata and selects an English caption track', () => {
    const player = __testing.youtubePlayerData('var ytInitialPlayerResponse = {"videoDetails":{"title":"Video title","lengthSeconds":"125"},"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=x","languageCode":"en","kind":"asr"},{"baseUrl":"https://www.youtube.com/api/timedtext?v=x&lang=en-US","languageCode":"en-US"}]}}};');
    expect(player).toMatchObject({ title: 'Video title', duration: 125 });
    expect(__testing.pickYouTubeEnglishTrack(player.tracks)).toMatchObject({ languageCode: 'en-US' });
  });
});

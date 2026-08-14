import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { captionHash, parseVtt } from './vtt.js';

const DEEPLEARNING_PAGE_HOSTS = new Set(['learn.deeplearning.ai']);
const DEEPLEARNING_ASSET_HOSTS = new Set(['video.deeplearning.ai']);
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_CAPTION_BYTES = 3 * 1024 * 1024;
export const RESOLVER_VERSION = 'multi-source-v1';

function isPrivateAddress(address: string) {
  if (!isIP(address)) return true;
  return address === '::1' || address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:')
    || /^127\./.test(address) || /^10\./.test(address) || /^192\.168\./.test(address)
    || /^169\.254\./.test(address) || /^172\.(1[6-9]|2\d|3[01])\./.test(address);
}

async function validateUrl(value: string, hosts: Set<string>) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !hosts.has(url.hostname)) throw new Error('不支持的课程或资源地址');
  const records = await lookup(url.hostname, { all: true });
  if (!records.length || records.some((record) => isPrivateAddress(record.address))) throw new Error('资源地址解析到了不安全的网络位置');
  return url;
}

async function safeFetch(value: string, hosts: Set<string>, maxBytes: number, redirects = 0): Promise<{ url: URL; text: string }> {
  if (redirects > 3) throw new Error('上游重定向次数过多');
  const url = await validateUrl(value, hosts);
  const response = await fetch(url, {
    redirect: 'manual',
    headers: { 'User-Agent': 'EchoLine/1.0 local-learning-player', Accept: 'text/html,text/vtt,*/*;q=0.8' },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) throw new Error('上游返回了无效重定向');
    return safeFetch(new URL(location, url).toString(), hosts, maxBytes, redirects + 1);
  }
  if (!response.ok) throw new Error(`上游返回 ${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error('上游响应超过大小限制');
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) throw new Error('上游响应超过大小限制');
  return { url, text: new TextDecoder().decode(buffer) };
}

function decodeEmbeddedHtml(source: string) {
  return source
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003d/gi, '=')
    .replace(/&amp;/g, '&')
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"');
}

function uniqueUrls(source: string, extension: 'm3u8' | 'vtt') {
  const pattern = extension === 'm3u8'
    ? /https:\/\/video\.deeplearning\.ai\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/g
    : /https:\/\/video\.deeplearning\.ai\/[^\s"'<>\\]+\.vtt[^\s"'<>\\]*/g;
  return [...new Set(source.match(pattern) || [])].map((url) => url.replace(/[),\]}]+$/, ''));
}

function pageTitle(html: string, sourceUrl?: string, fallback?: string) {
  const slug = sourceUrl ? new URL(sourceUrl).pathname.match(/\/lesson\/([^/]+)/)?.[1] : undefined;
  const escapedSlug = slug?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lessonName = escapedSlug
    ? html.match(new RegExp(`["']${escapedSlug}["']\\s*:\\s*\\{[^{}]{0,800}?["']name["']\\s*:\\s*["']([^"']+)`, 'i'))?.[1]
      || html.match(new RegExp(`["']slug["']\\s*:\\s*["']${escapedSlug}["'][^{}]{0,500}?["']name["']\\s*:\\s*["']([^"']+)`, 'i'))?.[1]
    : undefined;
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1];
  const title = fallback || lessonName || og || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '未命名课时';
  return title.replace(/\s*[-|]\s*DeepLearning\.AI.*$/i, '').trim();
}

function pickTrack(urls: string[], language: 'en' | 'zh') {
  if (language === 'en') return urls.find((url) => /(?:\/eng\/|[-_/]eng(?:[-_.?/]|$)|en-US)/i.test(url)) || urls[0];
  return urls.find((url) => /(?:\/zh(?:o|s|t)?\/|[-_/](?:zh-CN|zho|chi|chs|cht)(?:[-_.?/]|$))/i.test(url));
}

function getVideoId(mediaUrl: string) {
  const filename = new URL(mediaUrl).pathname.split('/').pop() || '';
  return filename.replace(/-master\.m3u8$/i, '').replace(/\.m3u8$/i, '') || null;
}

function youtubeVideoId(sourceUrl: string) {
  let url: URL;
  try { url = new URL(sourceUrl); } catch { return null; }
  const host = url.hostname.toLowerCase();
  const pathParts = url.pathname.split('/').filter(Boolean);
  let candidate = '';
  if (host === 'youtu.be') candidate = pathParts[0] || '';
  else if (YOUTUBE_HOSTS.has(host)) {
    if (url.pathname === '/watch') candidate = url.searchParams.get('v') || '';
    else if (['embed', 'shorts', 'live'].includes(pathParts[0] || '')) candidate = pathParts[1] || '';
  }
  return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
}

function extractJsonObject(source: string, marker: string) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = source.indexOf('{', markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0; let quote = ''; let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

type YouTubeCaptionTrack = { baseUrl: string; languageCode: string; kind?: string };
type YouTubePlayerData = { title: string | null; duration: number | null; tracks: YouTubeCaptionTrack[] };

function youtubePlayerData(source: string): YouTubePlayerData {
  const serialized = extractJsonObject(source, 'ytInitialPlayerResponse =') || extractJsonObject(source, 'ytInitialPlayerResponse=');
  if (!serialized) return { title: null, duration: null, tracks: [] };
  try {
    const parsed = JSON.parse(serialized) as any;
    const trackList = parsed?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    const tracks = Array.isArray(trackList) ? trackList
      .filter((track: any) => typeof track?.baseUrl === 'string' && typeof track?.languageCode === 'string')
      .map((track: any) => ({ baseUrl: track.baseUrl, languageCode: track.languageCode, ...(typeof track.kind === 'string' ? { kind: track.kind } : {}) })) : [];
    const length = Number(parsed?.videoDetails?.lengthSeconds);
    return {
      title: typeof parsed?.videoDetails?.title === 'string' ? parsed.videoDetails.title : null,
      duration: Number.isFinite(length) && length > 0 ? length : null,
      tracks,
    };
  } catch { return { title: null, duration: null, tracks: [] }; }
}

function pickYouTubeEnglishTrack(tracks: YouTubeCaptionTrack[]) {
  const english = tracks.filter((track) => /^en(?:-|$)/i.test(track.languageCode));
  return english.find((track) => track.kind !== 'asr') || english[0] || null;
}

export type ResolvedAssets = {
  title: string;
  sourceVideoId: string | null;
  duration: number | null;
  cues: ReturnType<typeof parseVtt>;
  hash: string;
  officialChinese?: string[];
  playback: { kind: 'hls'; mediaUrl: string } | { kind: 'youtube'; videoId: string };
  captionStatus: 'ready' | 'unavailable';
};

async function resolveDeepLearningAssets(sourceUrl: string, fallbackTitle?: string): Promise<ResolvedAssets> {
  const { text: rawHtml } = await safeFetch(sourceUrl, DEEPLEARNING_PAGE_HOSTS, MAX_HTML_BYTES);
  const html = decodeEmbeddedHtml(rawHtml);
  const mediaCandidates = uniqueUrls(html, 'm3u8');
  const mediaUrl = mediaCandidates.find((url) => /-master\.m3u8/i.test(url)) || mediaCandidates[0];
  if (!mediaUrl) throw new Error('课程页面中没有找到可播放的 HLS 媒体');
  const captionCandidates = uniqueUrls(html, 'vtt');
  const englishUrl = pickTrack(captionCandidates, 'en');
  if (!englishUrl) throw new Error('课程页面中没有找到英文字幕');
  const chineseUrl = pickTrack(captionCandidates, 'zh') || null;
  const english = await safeFetch(englishUrl, DEEPLEARNING_ASSET_HOSTS, MAX_CAPTION_BYTES);
  const cues = parseVtt(english.text);
  let officialChinese: string[] | undefined;
  if (chineseUrl && chineseUrl !== englishUrl) {
    try {
      const chinese = parseVtt((await safeFetch(chineseUrl, DEEPLEARNING_ASSET_HOSTS, MAX_CAPTION_BYTES)).text, 'zh');
      if (chinese.length === cues.length) officialChinese = chinese.map((cue) => cue.en);
    } catch { /* official Chinese is optional */ }
  }
  const durationCandidate = html.match(/["']duration["']\s*:\s*(\d+(?:\.\d+)?)/i)?.[1];
  return {
    title: pageTitle(html, sourceUrl, fallbackTitle), sourceVideoId: getVideoId(mediaUrl),
    duration: durationCandidate ? Number(durationCandidate) : cues.at(-1)?.end || null,
    cues, hash: captionHash(cues), officialChinese, playback: { kind: 'hls', mediaUrl }, captionStatus: 'ready',
  };
}

async function resolveYouTubeAssets(sourceUrl: string, videoId: string, fallbackTitle?: string): Promise<ResolvedAssets> {
  const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const { text: html } = await safeFetch(pageUrl, YOUTUBE_HOSTS, MAX_HTML_BYTES);
  const player = youtubePlayerData(html);
  const track = pickYouTubeEnglishTrack(player.tracks);
  let cues: ReturnType<typeof parseVtt> = [];
  if (track) {
    try {
      const trackUrl = new URL(track.baseUrl);
      trackUrl.searchParams.set('fmt', 'vtt');
      cues = parseVtt((await safeFetch(trackUrl.toString(), YOUTUBE_HOSTS, MAX_CAPTION_BYTES)).text);
    } catch { cues = []; }
  }
  return {
    title: fallbackTitle || player.title || `YouTube 视频 ${videoId}`,
    sourceVideoId: videoId,
    duration: player.duration || cues.at(-1)?.end || null,
    cues,
    hash: captionHash(cues),
    playback: { kind: 'youtube', videoId },
    captionStatus: cues.length ? 'ready' : 'unavailable',
  };
}

export async function resolveLessonAssets(sourceUrl: string, fallbackTitle?: string): Promise<ResolvedAssets> {
  const videoId = youtubeVideoId(sourceUrl);
  if (videoId) return resolveYouTubeAssets(sourceUrl, videoId, fallbackTitle);
  return resolveDeepLearningAssets(sourceUrl, fallbackTitle);
}

export const __testing = { decodeEmbeddedHtml, uniqueUrls, pageTitle, pickTrack, getVideoId, isPrivateAddress, youtubeVideoId, extractJsonObject, youtubePlayerData, pickYouTubeEnglishTrack };

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { captionHash, parseVtt } from './vtt.js';

const PAGE_HOSTS = new Set(['learn.deeplearning.ai']);
const ASSET_HOSTS = new Set(['video.deeplearning.ai']);
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_CAPTION_BYTES = 3 * 1024 * 1024;
export const RESOLVER_VERSION = 'deeplearning-v1';

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

export type ResolvedAssets = {
  title: string;
  sourceVideoId: string | null;
  mediaUrl: string;
  englishUrl: string;
  chineseUrl: string | null;
  duration: number | null;
  cues: ReturnType<typeof parseVtt>;
  hash: string;
  officialChinese?: string[];
};

export async function resolveLessonAssets(sourceUrl: string, fallbackTitle?: string): Promise<ResolvedAssets> {
  const { text: rawHtml } = await safeFetch(sourceUrl, PAGE_HOSTS, MAX_HTML_BYTES);
  const html = decodeEmbeddedHtml(rawHtml);
  const mediaCandidates = uniqueUrls(html, 'm3u8');
  const mediaUrl = mediaCandidates.find((url) => /-master\.m3u8/i.test(url)) || mediaCandidates[0];
  if (!mediaUrl) throw new Error('课程页面中没有找到可播放的 HLS 媒体');
  const captionCandidates = uniqueUrls(html, 'vtt');
  const englishUrl = pickTrack(captionCandidates, 'en');
  if (!englishUrl) throw new Error('课程页面中没有找到英文字幕');
  const chineseUrl = pickTrack(captionCandidates, 'zh') || null;
  const english = await safeFetch(englishUrl, ASSET_HOSTS, MAX_CAPTION_BYTES);
  const cues = parseVtt(english.text);
  let officialChinese: string[] | undefined;
  if (chineseUrl && chineseUrl !== englishUrl) {
    try {
      const chinese = parseVtt((await safeFetch(chineseUrl, ASSET_HOSTS, MAX_CAPTION_BYTES)).text);
      if (chinese.length === cues.length) officialChinese = chinese.map((cue) => cue.en);
    } catch { /* official Chinese is optional */ }
  }
  const durationCandidate = html.match(/["']duration["']\s*:\s*(\d+(?:\.\d+)?)/i)?.[1];
  return {
    title: pageTitle(html, sourceUrl, fallbackTitle), sourceVideoId: getVideoId(mediaUrl), mediaUrl,
    englishUrl, chineseUrl, duration: durationCandidate ? Number(durationCandidate) : cues.at(-1)?.end || null,
    cues, hash: captionHash(cues), officialChinese,
  };
}

export const __testing = { decodeEmbeddedHtml, uniqueUrls, pageTitle, pickTrack, getVideoId, isPrivateAddress };

import { z } from 'zod';
import type { EchoDatabase } from './db.js';

const TRANSLATION_VERSION = 'free-translation-v1';
let requestQueue = Promise.resolve();
let lastRequestFinishedAt = 0;
const cueRequests = new Map<string, Promise<TranslationRow>>();

type TranslationRow = { id: string; text: string };
type Provider = 'mymemory' | 'libretranslate';

const myMemorySchema = z.object({
  responseData: z.object({ translatedText: z.string() }),
  responseStatus: z.union([z.number(), z.string()]).optional(),
  responseDetails: z.string().optional(),
  quotaFinished: z.boolean().optional(),
});
const libreSchema = z.object({ translatedText: z.string() });

function config() {
  const provider = process.env.TRANSLATION_PROVIDER === 'libretranslate' ? 'libretranslate' : 'mymemory';
  return {
    provider,
    timeout: Math.max(3_000, Number(process.env.TRANSLATION_TIMEOUT_MS || 15_000)),
    interval: Math.max(0, Number(process.env.TRANSLATION_REQUEST_INTERVAL_MS || 500)),
    myMemoryEmail: process.env.MYMEMORY_EMAIL || '',
    libreUrl: (process.env.LIBRETRANSLATE_URL || '').replace(/\/$/, ''),
    libreApiKey: process.env.LIBRETRANSLATE_API_KEY || '',
  } as const;
}

function decodeText(value: string): string {
  return value.replace(/&quot;/gi, '"').replace(/&#(?:39|x27);/gi, "'").replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').trim();
}

function parseMyMemory(value: unknown): string {
  const result = myMemorySchema.parse(value);
  const status = Number(result.responseStatus || 200);
  if (result.quotaFinished || status !== 200) throw new Error(result.responseDetails || 'MyMemory 免费翻译额度已用完，请稍后再试');
  const text = decodeText(result.responseData.translatedText);
  if (!text) throw new Error('MyMemory 没有返回翻译结果');
  return text;
}

function parseLibre(value: unknown): string {
  const text = decodeText(libreSchema.parse(value).translatedText);
  if (!text) throw new Error('LibreTranslate 没有返回翻译结果');
  return text;
}

async function scheduleRequest<T>(request: () => Promise<T>): Promise<T> {
  const previous = requestQueue;
  let release: () => void = () => {};
  requestQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  const wait = Math.max(0, lastRequestFinishedAt + config().interval - Date.now());
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  try { return await request(); } finally { lastRequestFinishedAt = Date.now(); release(); }
}

async function requestTranslation(text: string, attempt = 0): Promise<{ text: string; provider: Provider; model: string }> {
  const settings = config();
  let response: Response;
  if (settings.provider === 'libretranslate') {
    if (!settings.libreUrl) throw new Error('使用 LibreTranslate 时必须配置 LIBRETRANSLATE_URL');
    response = await fetch(`${settings.libreUrl}/translate`, {
      method: 'POST', signal: AbortSignal.timeout(settings.timeout),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, source: 'en', target: 'zh', format: 'text', ...(settings.libreApiKey ? { api_key: settings.libreApiKey } : {}) }),
    });
  } else {
    const url = new URL('https://api.mymemory.translated.net/get');
    url.searchParams.set('q', text); url.searchParams.set('langpair', 'en|zh-CN');
    if (settings.myMemoryEmail) url.searchParams.set('de', settings.myMemoryEmail);
    response = await fetch(url, { signal: AbortSignal.timeout(settings.timeout) });
  }
  if (!response.ok) {
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 800 * (2 ** attempt)));
      return requestTranslation(text, attempt + 1);
    }
    const detail = (await response.text()).replace(/[\r\n]+/g, ' ').slice(0, 240);
    throw new Error(`${settings.provider === 'mymemory' ? 'MyMemory' : 'LibreTranslate'} 返回 ${response.status}${detail ? `：${detail}` : ''}`);
  }
  const result = await response.json() as unknown;
  return settings.provider === 'mymemory'
    ? { text: parseMyMemory(result), provider: 'mymemory', model: 'en-zh-CN' }
    : { text: parseLibre(result), provider: 'libretranslate', model: settings.libreUrl };
}

export async function translateCue(db: EchoDatabase, lessonId: string, cueId: string): Promise<TranslationRow> {
  if (!db.getLesson(lessonId)) throw new Error('课时不存在');
  const { cues, sourceHash, sourceKind } = db.getCues(lessonId);
  if (!sourceHash || !cues.length) throw new Error('课时没有可翻译的英文字幕');
  const cue = cues.find((item) => item.id === cueId);
  if (!cue) throw new Error('字幕句子不存在');
  if (sourceKind === 'official' || cue.zh) return { id: cue.id, text: cue.zh || '' };
  const requestKey = `${lessonId}:${sourceHash}:${cueId}`;
  const existing = cueRequests.get(requestKey);
  if (existing) return existing;
  const request = (async () => {
    const translated = await scheduleRequest(() => requestTranslation(cue.en));
    const row = { id: cue.id, text: translated.text };
    db.saveTranslations(lessonId, sourceHash, [row], translated.provider, translated.model, TRANSLATION_VERSION);
    db.updateTranslationCoverage(lessonId);
    return row;
  })();
  cueRequests.set(requestKey, request);
  try { return await request; } finally { cueRequests.delete(requestKey); }
}

export const __testing = { config, decodeText, parseLibre, parseMyMemory };

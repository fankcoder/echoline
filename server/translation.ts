import type { EchoDatabase } from './db.js';

const PROMPT_VERSION = 'bilingual-cue-v2';
let requestQueue = Promise.resolve();
let lastRequestFinishedAt = 0;
const cueRequests = new Map<string, Promise<TranslationRow>>();
const SYSTEM_PROMPT = 'Translate every English technical-course subtitle into natural, accurate Simplified Chinese. Use standard Chinese technical terminology. Preserve every id and return only a JSON array of objects shaped as [{"id":"...","text":"..."}]. Do not use Markdown, merge, split, omit, or reorder subtitles.';

type TranslationRow = { id: string; text: string };
type InputRow = { id: string; en: string };
type Protocol = 'responses' | 'chat-completions';

class TranslationApiError extends Error {
  constructor(readonly status: number, readonly protocol: Protocol, readonly code: string, message: string) {
    super(message);
  }
}

function config() {
  const configuredProtocol = process.env.OPENAI_API_PROTOCOL;
  return {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    timeout: Number(process.env.OPENAI_TIMEOUT_MS || 45_000),
    protocol: configuredProtocol === 'responses' || configuredProtocol === 'chat-completions' ? configuredProtocol : 'auto',
  } as const;
}

function parseResponse(value: string): TranslationRow[] {
  const clean = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(clean) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => !item || typeof item.id !== 'string' || typeof item.text !== 'string')) {
    throw new Error('LLM 返回格式不符合字幕协议');
  }
  return parsed;
}

function responseText(protocol: Protocol, result: any): string {
  if (protocol === 'chat-completions') return result?.choices?.[0]?.message?.content || '';
  if (typeof result?.output_text === 'string') return result.output_text;
  for (const item of Array.isArray(result?.output) ? result.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if ((content?.type === 'output_text' || content?.type === 'text') && typeof content.text === 'string') return content.text;
    }
  }
  return '';
}

function protocols(model: string, configured: 'auto' | Protocol): Protocol[] {
  if (configured !== 'auto') return [configured];
  return /^(?:gpt-5|o[134])(?:[.-]|$)/i.test(model)
    ? ['responses', 'chat-completions']
    : ['chat-completions', 'responses'];
}

function apiError(status: number, protocol: Protocol, raw: string): TranslationApiError {
  let code = '';
  let message = raw;
  try {
    const parsed = JSON.parse(raw) as any;
    code = String(parsed?.error?.code || parsed?.code || '');
    message = String(parsed?.error?.message || parsed?.message || raw);
  } catch { /* retain plain-text provider error */ }
  const safeMessage = message.replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
  return new TranslationApiError(status, protocol, code, `LLM ${protocol === 'responses' ? 'Responses' : 'Chat Completions'} 接口返回 ${status}${safeMessage ? `：${safeMessage}` : ''}`);
}

function unsupportedProtocol(error: unknown): boolean {
  if (!(error instanceof TranslationApiError) || ![400, 404, 405, 422].includes(error.status)) return false;
  return /protocol|chat.?completions|responses|not supported|unsupported|不支持/i.test(`${error.code} ${error.message}`);
}

function splitLongCue(row: InputRow): InputRow[] {
  const clauses = row.en.match(/[^,;:]+[,;:]?/g)?.map((value) => value.trim()).filter(Boolean) || [row.en];
  const chunks: string[] = [];
  for (const clause of clauses) {
    const current = chunks.at(-1);
    if (current && `${current} ${clause}`.length <= 120) chunks[chunks.length - 1] = `${current} ${clause}`;
    else chunks.push(clause);
  }
  return chunks.map((en, index) => ({ id: `${row.id}__part_${index + 1}`, en }));
}

async function scheduleRequest<T>(request: () => Promise<T>): Promise<T> {
  const previous = requestQueue;
  let release: () => void = () => {};
  requestQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  const interval = Math.max(0, Number(process.env.OPENAI_REQUEST_INTERVAL_MS || 2_500));
  const wait = Math.max(0, lastRequestFinishedAt + interval - Date.now());
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  try { return await request(); } finally { lastRequestFinishedAt = Date.now(); release(); }
}

async function requestProtocol(rows: InputRow[], protocol: Protocol, attempt = 0): Promise<TranslationRow[]> {
  const settings = config();
  const endpoint = protocol === 'responses' ? 'responses' : 'chat/completions';
  const input = JSON.stringify(rows);
  const body = protocol === 'responses'
    ? { model: settings.model, input: [{ role: 'user', content: [{ type: 'input_text', text: `${SYSTEM_PROMPT}\n\n输入：${input}` }] }] }
    : { model: settings.model, temperature: 0.1, messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: input },
    ] };
  const response = await fetch(`${settings.baseUrl}/${endpoint}`, {
    method: 'POST', signal: AbortSignal.timeout(settings.timeout),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  if (!response.ok) {
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 700 * (2 ** attempt)));
      return requestProtocol(rows, protocol, attempt + 1);
    }
    throw apiError(response.status, protocol, raw);
  }
  let result: unknown;
  try { result = JSON.parse(raw); } catch { throw new Error('LLM 返回了无法解析的 JSON 响应'); }
  const text = responseText(protocol, result);
  if (!text) {
    const retryLimit = rows.length === 1 ? 4 : 1;
    if (attempt < retryLimit) {
      await new Promise((resolve) => setTimeout(resolve, 3_000 * (attempt + 1)));
      return requestProtocol(rows, protocol, attempt + 1);
    }
    throw new Error(`LLM ${protocol === 'responses' ? 'Responses' : 'Chat Completions'} 请求成功但没有返回文本`);
  }
  try { return parseResponse(text); } catch (error) {
    if (attempt >= 1) throw error;
    await new Promise((resolve) => setTimeout(resolve, 700 * (2 ** attempt)));
    return requestProtocol(rows, protocol, attempt + 1);
  }
}

async function translateBatch(rows: InputRow[]): Promise<TranslationRow[]> {
  const settings = config();
  const candidates = protocols(settings.model, settings.protocol);
  let lastError: unknown;
  for (let index = 0; index < candidates.length; index += 1) {
    try {
      const translated = await scheduleRequest(() => requestProtocol(rows, candidates[index]));
      const requested = new Set(rows.map((row) => row.id));
      if (translated.length !== rows.length || translated.some((row) => !requested.has(row.id))) throw new Error('LLM 返回的字幕 ID 与请求不一致');
      return translated;
    } catch (error) {
      lastError = error;
      if (unsupportedProtocol(error) && index < candidates.length - 1) continue;
      if (rows.length > 1) {
        const middle = Math.ceil(rows.length / 2);
        return [...await translateBatch(rows.slice(0, middle)), ...await translateBatch(rows.slice(middle))];
      }
      if (rows[0].en.length > 120) {
        const parts = splitLongCue(rows[0]);
        if (parts.length > 1) {
          const translated = await translateBatch(parts);
          return [{ id: rows[0].id, text: translated.map((row) => row.text).join('') }];
        }
      }
      throw error;
    }
  }
  throw lastError;
}

export async function translateCue(db: EchoDatabase, lessonId: string, cueId: string): Promise<TranslationRow> {
  if (!db.getLesson(lessonId)) throw new Error('课时不存在');
  const { cues, sourceHash, sourceKind } = db.getCues(lessonId);
  if (!sourceHash || !cues.length) throw new Error('课时没有可翻译的英文字幕');
  const cue = cues.find((item) => item.id === cueId);
  if (!cue) throw new Error('字幕句子不存在');
  if (sourceKind === 'official' || cue.zh) return { id: cue.id, text: cue.zh || '' };
  const settings = config();
  if (!settings.apiKey) throw new Error('未配置 OPENAI_API_KEY；请先配置 .env 再翻译本句');
  const requestKey = `${lessonId}:${sourceHash}:${cueId}`;
  const existing = cueRequests.get(requestKey);
  if (existing) return existing;
  const request = (async () => {
    const translated = (await translateBatch([{ id: cue.id, en: cue.en }]))[0];
    db.saveTranslations(lessonId, sourceHash, [translated], 'openai-compatible', settings.model, PROMPT_VERSION);
    db.updateTranslationCoverage(lessonId);
    return translated;
  })();
  cueRequests.set(requestKey, request);
  try { return await request; } finally { cueRequests.delete(requestKey); }
}

export const __testing = { apiError, parseResponse, protocols, responseText, splitLongCue, unsupportedProtocol };

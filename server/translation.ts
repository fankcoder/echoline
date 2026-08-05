import type { EchoDatabase } from './db.js';

const PROMPT_VERSION = 'bilingual-cue-v1';
const running = new Set<string>();

function config() {
  return {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    timeout: Number(process.env.OPENAI_TIMEOUT_MS || 45_000),
    batchSize: Math.max(1, Math.min(20, Number(process.env.OPENAI_TRANSLATION_BATCH_SIZE || 10))),
  };
}

function parseResponse(value: string): Array<{ id: string; text: string }> {
  const clean = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(clean) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => !item || typeof item.id !== 'string' || typeof item.text !== 'string')) {
    throw new Error('LLM 返回格式不符合字幕协议');
  }
  return parsed;
}

async function translateBatch(rows: Array<{ id: string; en: string }>, attempt = 0): Promise<Array<{ id: string; text: string }>> {
  const settings = config();
  const response = await fetch(`${settings.baseUrl}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(settings.timeout),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify({
      model: settings.model, temperature: 0.1,
      messages: [
        { role: 'system', content: '你是英语课程字幕译者。把输入逐句翻成自然、准确、简洁的简体中文。保持 id 不变，只返回 JSON 数组 [{"id":"...","text":"..."}]，不要 Markdown。结合批次上下文，但不得合并、拆分或漏掉句子。' },
        { role: 'user', content: JSON.stringify(rows) },
      ],
    }),
  });
  if (!response.ok) {
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 700 * (2 ** attempt)));
      return translateBatch(rows, attempt + 1);
    }
    throw new Error(`LLM 翻译接口返回 ${response.status}`);
  }
  const result = await response.json() as any;
  const translated = parseResponse(result.choices?.[0]?.message?.content || '');
  const requested = new Set(rows.map((row) => row.id));
  if (translated.length !== rows.length || translated.some((row) => !requested.has(row.id))) throw new Error('LLM 返回的字幕 ID 与请求不一致');
  return translated;
}

export function startTranslation(db: EchoDatabase, lessonId: string): string {
  const lesson = db.getLesson(lessonId);
  if (!lesson) throw new Error('课时不存在');
  const { cues, sourceHash, sourceKind } = db.getCues(lessonId);
  if (!sourceHash || !cues.length) throw new Error('课时没有可翻译的英文字幕');
  const jobId = db.createJob(lessonId);
  if (sourceKind === 'official' || cues.every((cue) => cue.zh)) {
    db.updateJob(jobId, 'completed', 1); db.setTranslationState(lessonId, 'ready', 1); return jobId;
  }
  if (running.has(lessonId)) { db.updateJob(jobId, 'waiting', lesson.translationProgress); return jobId; }
  const settings = config();
  if (!settings.apiKey) {
    const error = '未配置 OPENAI_API_KEY；英文字幕仍可正常使用';
    db.updateJob(jobId, 'failed', 0, error); db.setTranslationState(lessonId, 'failed', 0); return jobId;
  }
  running.add(lessonId);
  void (async () => {
    try {
      db.updateJob(jobId, 'running', 0); db.setTranslationState(lessonId, 'running', 0);
      const pending = cues.filter((cue) => !cue.zh);
      for (let index = 0; index < pending.length; index += settings.batchSize) {
        const batch = pending.slice(index, index + settings.batchSize).map(({ id, en }) => ({ id, en }));
        const translated = await translateBatch(batch);
        db.saveTranslations(lessonId, sourceHash, translated, 'openai-compatible', settings.model, PROMPT_VERSION);
        const progress = Math.min(1, (index + batch.length) / pending.length);
        db.updateJob(jobId, 'running', progress); db.setTranslationState(lessonId, 'running', progress);
      }
      db.updateJob(jobId, 'completed', 1); db.setTranslationState(lessonId, 'ready', 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : '翻译失败';
      const progress = db.getJob(jobId)?.progress || 0;
      db.updateJob(jobId, 'failed', progress, message); db.setTranslationState(lessonId, 'failed', progress);
    } finally { running.delete(lessonId); }
  })();
  return jobId;
}

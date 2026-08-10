import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { EchoDatabase } from './db.js';

const DICTIONARY_VERSION = 'ecdict-2026.08';
const defaultDictionaryPath = resolve('data/dictionaries/ecdict.db');

const builtIn: Record<string, { ipa: string; type: string; meaning: string; note: string }> = {
  novice: { ipa: '/ˈnɑːvɪs/', type: 'n.', meaning: '新手；初学者', note: '刚进入某个领域、经验尚少的人。' },
  prompting: { ipa: '/ˈprɑːmptɪŋ/', type: 'n.', meaning: '提示；向 AI 提供指令的过程', note: '在 AI 语境中指编写并提交提示词。' },
  context: { ipa: '/ˈkɑːntekst/', type: 'n.', meaning: '语境；背景信息', note: '完成任务所需的材料、限制和背景。' },
  impactful: { ipa: '/ɪmˈpæktfəl/', type: 'adj.', meaning: '有重大影响的；效果显著的', note: '强调实际产生了明显影响。' },
  pretrained: { ipa: '/ˌpriːˈtreɪnd/', type: 'adj.', meaning: '预训练的', note: '指模型已经在大规模数据上完成基础训练。' },
  pretraining: { ipa: '/ˌpriːˈtreɪnɪŋ/', type: 'n.', meaning: '预训练', note: '模型在执行具体任务前进行的大规模基础训练。' },
};

function dictionaryPath(): string {
  return process.env.ECDICT_PATH ? resolve(process.env.ECDICT_PATH) : defaultDictionaryPath;
}

function cleanField(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\\n/g, '；').replace(/\s*；\s*/g, '；').trim() : '';
}

function wordCandidates(word: string): string[] {
  const candidates = [word];
  if (word.endsWith('ies') && word.length > 4) candidates.push(`${word.slice(0, -3)}y`);
  if (word.endsWith('es') && word.length > 4) candidates.push(word.slice(0, -2));
  if (word.endsWith('s') && word.length > 3) candidates.push(word.slice(0, -1));
  if (word.endsWith('ing') && word.length > 5) {
    const stem = word.slice(0, -3); candidates.push(stem, `${stem}e`);
    if (stem.at(-1) === stem.at(-2)) candidates.push(stem.slice(0, -1));
  }
  if (word.endsWith('ed') && word.length > 4) {
    const stem = word.slice(0, -2); candidates.push(stem, `${stem}e`);
    if (stem.at(-1) === stem.at(-2)) candidates.push(stem.slice(0, -1));
  }
  return [...new Set(candidates)];
}

function queryEcdict(word: string) {
  const filename = dictionaryPath();
  if (!existsSync(filename)) return null;
  const dictionary = new DatabaseSync(filename, { readOnly: true });
  try {
    const query = dictionary.prepare('SELECT word,phonetic,definition,translation,pos,collins,oxford,tag FROM stardict WHERE word=? COLLATE NOCASE LIMIT 1');
    const row = wordCandidates(word).map((candidate) => query.get(candidate) as any).find((candidate) => candidate && cleanField(candidate.translation));
    if (!row || !cleanField(row.translation)) return null;
    const labels = [row.collins ? `柯林斯 ${row.collins} 星` : '', row.oxford ? '牛津核心词' : '', cleanField(row.tag)].filter(Boolean).join(' · ');
    const definition = cleanField(row.definition);
    return {
      word: row.word,
      ipa: row.phonetic ? `/${row.phonetic}/` : '',
      type: cleanField(row.pos) || 'word',
      meaning: cleanField(row.translation),
      note: [row.word.toLowerCase() !== word ? `原形：${row.word}` : '', definition, labels].filter(Boolean).join('；'),
      example: '', audio: '', source: 'ECDICT 英汉词典（约 77 万词条）', dictionaryVersion: DICTIONARY_VERSION,
    };
  } finally { dictionary.close(); }
}

async function remoteSupplement(word: string) {
  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, { signal: AbortSignal.timeout(6000) });
    if (response.ok) return (await response.json() as any[])?.[0] || null;
  } catch { /* offline dictionary remains fully usable */ }
  return null;
}

export async function lookupWord(db: EchoDatabase, rawWord: string) {
  const word = rawWord.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '');
  if (!word) throw new Error('单词无效');
  const cached = db.getDictionary(word) as any;
  if (cached?.dictionaryVersion === DICTIONARY_VERSION) return cached;

  let result = queryEcdict(word);
  const fallback = builtIn[word];
  result ||= fallback ? { word, ...fallback, example: '', audio: '', source: 'EchoLine 本地英汉词典', dictionaryVersion: DICTIONARY_VERSION } : null;
  if (!result) {
    if (!existsSync(dictionaryPath())) throw new Error('离线英汉词典尚未安装，请运行 npm run dictionary:install');
    throw new Error('ECDICT 中没有找到这个单词');
  }

  const remote = process.env.DICTIONARY_REMOTE_SUPPLEMENT === 'true' ? await remoteSupplement(word) : null;
  const meaning = remote?.meanings?.[0];
  const definition = meaning?.definitions?.[0];
  const payload = {
    ...result,
    word,
    ipa: result.ipa || remote?.phonetic || remote?.phonetics?.find((item: any) => item.text)?.text || '',
    type: result.type || meaning?.partOfSpeech || 'word',
    note: result.note || definition?.definition || '',
    example: definition?.example || '',
    audio: remote?.phonetics?.find((item: any) => item.audio)?.audio || '',
  };
  db.saveDictionary(word, payload, payload.source, DICTIONARY_VERSION);
  return payload;
}

export const __testing = { cleanField, dictionaryPath, wordCandidates };

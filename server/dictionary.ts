import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { EchoDatabase } from './db.js';

const builtIn: Record<string, { ipa: string; type: string; meaning: string; note: string }> = {
  novice: { ipa: '/ˈnɑːvɪs/', type: 'n.', meaning: '新手；初学者', note: '刚进入某个领域、经验尚少的人。' },
  prompting: { ipa: '/ˈprɑːmptɪŋ/', type: 'n.', meaning: '提示；向 AI 提供指令的过程', note: '在 AI 语境中指编写并提交提示词。' },
  context: { ipa: '/ˈkɑːntekst/', type: 'n.', meaning: '语境；背景信息', note: '完成任务所需的材料、限制和背景。' },
  impactful: { ipa: '/ɪmˈpæktfəl/', type: 'adj.', meaning: '有重大影响的；效果显著的', note: '强调实际产生了明显影响。' },
};

function queryEcdict(word: string) {
  const filename = process.env.ECDICT_PATH;
  if (!filename || !existsSync(filename)) return null;
  const dictionary = new DatabaseSync(filename, { readOnly: true });
  try {
    const row = dictionary.prepare('SELECT word,phonetic,definition,translation,pos,collins,oxford,tag FROM stardict WHERE word=? COLLATE NOCASE LIMIT 1').get(word) as any;
    if (!row) return null;
    return { word: row.word, ipa: row.phonetic ? `/${row.phonetic}/` : '', type: row.pos || 'word', meaning: row.translation || row.definition || '暂无中文释义', note: row.definition || '', example: '', audio: '', source: 'ECDICT' };
  } finally { dictionary.close(); }
}

export async function lookupWord(db: EchoDatabase, rawWord: string) {
  const word = rawWord.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '');
  if (!word) throw new Error('单词无效');
  const cached = db.getDictionary(word);
  if (cached) return cached;
  let result = queryEcdict(word);
  let remote: any = null;
  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, { signal: AbortSignal.timeout(6000) });
    if (response.ok) remote = (await response.json() as any[])?.[0];
  } catch { /* local dictionary remains usable */ }
  const meaning = remote?.meanings?.[0]; const definition = meaning?.definitions?.[0]; const fallback = builtIn[word];
  result ||= fallback ? { word, ...fallback, example: '', audio: '', source: 'EchoLine 本地词典' } : null;
  if (!result && !remote) throw new Error('词典中没有找到这个单词');
  const payload = {
    word, ipa: result?.ipa || remote?.phonetic || remote?.phonetics?.find((item: any) => item.text)?.text || '',
    type: result?.type || meaning?.partOfSpeech || 'word',
    meaning: result?.meaning || definition?.definition || '暂无中文释义',
    note: result?.note || definition?.definition || '', example: definition?.example || result?.example || '',
    audio: remote?.phonetics?.find((item: any) => item.audio)?.audio || '', source: result?.source || 'Free Dictionary',
  };
  db.saveDictionary(word, payload, payload.source);
  return payload;
}

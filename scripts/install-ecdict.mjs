import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import console from 'node:console';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/* global fetch, AbortSignal */

const SOURCE_URL = process.env.ECDICT_CSV_URL || 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv';
const target = resolve(process.env.ECDICT_PATH || 'data/dictionaries/ecdict.db');
const csvFile = `${target}.csv.download`;
const MIN_SOURCE_BYTES = 60_000_000;

function parseCsvLine(line) {
  const fields = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) { fields.push(value); value = ''; }
    else value += character;
  }
  fields.push(value);
  return fields;
}

async function download() {
  const downloaded = existsSync(csvFile) ? statSync(csvFile).size : 0;
  console.log(`${downloaded ? '正在续传' : '正在下载'} ECDICT：${SOURCE_URL}`);
  const response = await fetch(SOURCE_URL, {
    redirect: 'follow', signal: AbortSignal.timeout(15 * 60_000),
    headers: downloaded ? { Range: `bytes=${downloaded}-` } : {},
  });
  if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(csvFile, { flags: downloaded && response.status === 206 ? 'a' : 'w' }));
}

mkdirSync(dirname(target), { recursive: true });
if (!existsSync(csvFile) || statSync(csvFile).size < MIN_SOURCE_BYTES) await download();
if (statSync(csvFile).size < MIN_SOURCE_BYTES) throw new Error('词典源文件不完整，请重新运行安装命令以续传');
if (existsSync(target)) unlinkSync(target);

const db = new DatabaseSync(target);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF; PRAGMA temp_store=MEMORY;
  CREATE TABLE stardict (
    word TEXT COLLATE NOCASE PRIMARY KEY, phonetic TEXT, definition TEXT, translation TEXT, pos TEXT,
    collins INTEGER, oxford INTEGER, tag TEXT, bnc INTEGER, frq INTEGER, exchange TEXT, detail TEXT, audio TEXT
  );`);
const insert = db.prepare('INSERT OR REPLACE INTO stardict VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
const reader = createInterface({ input: createReadStream(csvFile), crlfDelay: Infinity });

let count = 0;
let first = true;
db.exec('BEGIN');
for await (const line of reader) {
  if (first) { first = false; continue; }
  const fields = parseCsvLine(line);
  if (fields.length < 13 || !fields[0]) continue;
  insert.run(...fields.slice(0, 13).map((field) => field || null));
  count += 1;
  if (count % 25_000 === 0) process.stdout.write(`\r已导入 ${count.toLocaleString()} 词条`);
}
db.exec('COMMIT; CREATE INDEX idx_stardict_exchange ON stardict(exchange); PRAGMA optimize;');
db.close();
unlinkSync(csvFile);
console.log(`\n安装完成：${count.toLocaleString()} 词条，${(statSync(target).size / 1024 / 1024).toFixed(1)} MB`);
console.log(target);

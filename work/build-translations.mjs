import fs from 'node:fs/promises';

const input = await fs.readFile(new URL('../public/demo-en.vtt', import.meta.url), 'utf8');
const blocks = input.replace(/\r/g, '').split(/\n\n+/).filter((block) => block.includes('-->'));
const cues = blocks.map((block) => {
  const lines = block.split('\n');
  const timingIndex = lines.findIndex((line) => line.includes('-->'));
  return lines.slice(timingIndex + 1).join(' ').replace(/<[^>]+>/g, '').trim();
});

const outputUrl = new URL('../public/demo-zh.json', import.meta.url);
let translations = [];
try {
  translations = JSON.parse(await fs.readFile(outputUrl, 'utf8'));
} catch {}

for (let index = translations.length; index < cues.length; index += 1) {
  const params = new URLSearchParams({ q: cues[index], langpair: 'en|zh-CN' });
  const response = await fetch(`https://api.mymemory.translated.net/get?${params}`);
  if (!response.ok) throw new Error(`Translation failed at cue ${index + 1}: ${response.status}`);
  const data = await response.json();
  translations.push(data.responseData.translatedText);
  await fs.writeFile(outputUrl, `${JSON.stringify(translations, null, 2)}\n`);
  process.stdout.write(`\rTranslated ${index + 1}/${cues.length}`);
}

process.stdout.write('\n');

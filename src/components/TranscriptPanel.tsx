import { Bookmark, BookmarkCheck, BookOpen, BrainCircuit, Languages, Library, LoaderCircle, Pencil, Play, Search, Sparkles, Trash2, Volume2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { getBrowserSpeechAdapter, speakEnglish } from '../speech';
import type { Cue, DictionaryEntry, DictionarySearchDirection, DictionarySearchResult, VocabularyItem } from '../types';

function normalizeWord(value: string) { return value.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, ''); }

function normalizePhrase(value: string) { return value.toLowerCase().replace(/\s+/g, ' ').trim(); }

function WordText({ text, saved, onHover, onLeave, onToggle }: { text: string; saved: Set<string>; onHover: (word: string, rect: DOMRect) => void; onLeave: () => void; onToggle: (word: string) => void }) {
  return <>{text.split(/(\b[A-Za-z]+(?:['’-][A-Za-z]+)?\b)/).map((part, index) => {
    if (!/[A-Za-z]/.test(part)) return <span key={index}>{part}</span>;
    const word = normalizeWord(part);
    return <button key={`${word}-${index}`} className={`word ${saved.has(word) ? 'saved' : ''}`}
      onMouseEnter={(event) => onHover(word, event.currentTarget.getBoundingClientRect())} onMouseLeave={onLeave}
      onFocus={(event) => onHover(word, event.currentTarget.getBoundingClientRect())} onBlur={onLeave}
      onClick={(event) => { event.stopPropagation(); onToggle(word); }}>{part}</button>;
  })}</>;
}

function PhraseText({ text, phrases, saved, onHover, onLeave, onToggle }: { text: string; phrases: VocabularyItem[]; saved: Set<string>; onHover: (phrase: VocabularyItem, rect: DOMRect) => void; onLeave: () => void; onToggle: (word: string) => void }) {
  if (!phrases.length) return <WordText text={text} saved={saved} onHover={(word, rect) => onHover({ word, text: word, kind: 'word', meaning: '', note: '', example: '', lessonId: null, cueId: null, addedAt: 0, reviewCount: 0, lastReviewedAt: null, groupIndex: 0 }, rect)} onLeave={onLeave} onToggle={onToggle} />;
  const patterns = phrases.map((item) => item.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).sort((a, b) => b.length - a.length);
  const parts = text.split(new RegExp(`(\\b(?:${patterns.join('|')})\\b)`, 'ig'));
  return <>{parts.map((part, index) => {
    const phrase = phrases.find((item) => normalizePhrase(item.text) === normalizePhrase(part));
    if (!phrase) return <WordText key={index} text={part} saved={saved} onHover={(word, rect) => onHover({ word, text: word, kind: 'word', meaning: '', note: '', example: '', lessonId: null, cueId: null, addedAt: 0, reviewCount: 0, lastReviewedAt: null, groupIndex: 0 }, rect)} onLeave={onLeave} onToggle={onToggle} />;
    return <span key={`${phrase.word}-${index}`} className="phrase-saved" onMouseEnter={(event) => onHover(phrase, event.currentTarget.getBoundingClientRect())} onMouseLeave={onLeave}>{part}</span>;
  })}</>;
}

function DictionaryWorkbench() {
  const [direction, setDirection] = useState<DictionarySearchDirection>('en-zh');
  const [query, setQuery] = useState(''); const [result, setResult] = useState<DictionarySearchResult | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);

  const selectDirection = (next: DictionarySearchDirection) => {
    requestRef.current?.abort(); setDirection(next); setQuery(''); setResult(null); setError(''); setLoading(false);
  };
  const search = async () => {
    const value = query.trim(); if (!value) return;
    requestRef.current?.abort(); const controller = new AbortController(); requestRef.current = controller; setLoading(true); setError(''); setResult(null);
    try { setResult(await api<DictionarySearchResult>(`/api/dictionary/search?direction=${direction}&q=${encodeURIComponent(value)}`, { signal: controller.signal })); }
    catch (reason) { if ((reason as Error).name !== 'AbortError') setError((reason as Error).message); }
    finally { if (requestRef.current === controller) setLoading(false); }
  };
  const placeholder = direction === 'en-zh' ? '输入英文单词或短语' : '输入中文释义，例如：前沿';
  return <aside className="dictionary-workbench" aria-label="双向词典">
    <div className="dictionary-workbench-head"><div><span>Local Dictionary</span><strong>查词</strong></div><Languages size={18} /></div>
    <div className="dictionary-direction-tabs" role="tablist" aria-label="选择词典方向">
      <button type="button" role="tab" aria-selected={direction === 'en-zh'} className={direction === 'en-zh' ? 'active' : ''} onClick={() => selectDirection('en-zh')}>英汉词典</button>
      <button type="button" role="tab" aria-selected={direction === 'zh-en'} className={direction === 'zh-en' ? 'active' : ''} onClick={() => selectDirection('zh-en')}>汉英词典</button>
    </div>
    <form className="dictionary-search-form" onSubmit={(event) => { event.preventDefault(); void search(); }}>
      <Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} aria-label={placeholder} />
      <button type="submit" disabled={!query.trim() || loading}>{loading ? <LoaderCircle className="spin" size={14} /> : '查询'}</button>
    </form>
    <div className="dictionary-results" aria-live="polite">
      {loading && <p className="dictionary-state"><LoaderCircle className="spin" size={15} />正在查询本地词典…</p>}
      {error && <p className="dictionary-state error">{error}</p>}
      {!loading && !error && !result && <p className="dictionary-state">{direction === 'en-zh' ? '输入英文，查询英汉释义。' : '输入中文，反查对应英文词汇。'}</p>}
      {!loading && !error && result?.entries.length === 0 && <p className="dictionary-state">未找到“{result.query}”相关词条。</p>}
      {!loading && !error && result?.entries.map((entry) => <article className="dictionary-result" key={entry.word}>
        <div><strong>{entry.word}</strong><small>{entry.ipa} {entry.type}</small></div><p>{entry.meaning}</p>{entry.note && <span>{entry.note}</span>}
      </article>)}
    </div>
    <small className="dictionary-workbench-source">ECDICT 离线英汉词典 · 约 77 万词条</small>
  </aside>;
}

type Props = {
  cues: Cue[]; activeIndex: number; query: string; setQuery: (value: string) => void; onCue: (index: number) => void;
  vocabulary: VocabularyItem[]; tab: 'transcript' | 'vocabulary'; setTab: (tab: 'transcript' | 'vocabulary') => void;
  dictionary: DictionaryEntry | null; dictionaryLoading: boolean; inspectedWord: string;
  inspectedPhrase: VocabularyItem | null;
  tooltip: { x: number; y: number; above: boolean } | null;
  onWordHover: (word: string, rect: DOMRect) => void; onWordLeave: () => void; onWordToggle: (word: string) => void;
  onPhraseHover: (phrase: VocabularyItem, rect: DOMRect) => void; onPhraseSelection: (text: string, cueId: string) => void; onPhraseRemove: (phrase: VocabularyItem) => void; onPhraseEdit: (phrase: VocabularyItem) => void;
  onTranslate: (cueId: string) => void; translatingCueIds: Set<string>; onReview: () => void; onNotify: (message: string) => void; translationLabel: string;
};

export function TranscriptPanel(props: Props) {
  const saved = useMemo(() => new Set(props.vocabulary.map((item) => item.word)), [props.vocabulary]);
  const phrases = useMemo(() => props.vocabulary.filter((item) => item.kind === 'phrase'), [props.vocabulary]);
  const vocabularyMeaningCache = useRef(new Map<string, string>());
  const [vocabularyMeanings, setVocabularyMeanings] = useState<Record<string, string>>({});
  const speakingUtterance = useRef<SpeechSynthesisUtterance | null>(null);
  const [speakingItem, setSpeakingItem] = useState('');
  const inspectedPhrase = props.inspectedPhrase;
  const phraseSelectionRef = useRef(false);
  useEffect(() => {
    const missing = props.vocabulary.filter((item) => item.kind === 'word' && !vocabularyMeaningCache.current.has(item.word)).map((item) => item.word);
    if (!missing.length) return undefined;
    const controller = new AbortController();
    void Promise.all(missing.map(async (word) => {
      try {
        const entry = await api<DictionaryEntry>(`/api/dictionary/${encodeURIComponent(word)}`, { signal: controller.signal });
        return [word, entry.meaning || '暂无释义'] as const;
      } catch (reason) {
        if ((reason as Error).name === 'AbortError') return null;
        return [word, '暂无释义'] as const;
      }
    })).then((entries) => {
      if (controller.signal.aborted) return;
      const next: Record<string, string> = {};
      entries.forEach((entry) => { if (entry) { vocabularyMeaningCache.current.set(entry[0], entry[1]); next[entry[0]] = entry[1]; } });
      if (Object.keys(next).length) setVocabularyMeanings((current) => ({ ...current, ...next }));
    }).catch(() => undefined);
    return () => controller.abort();
  }, [props.vocabulary]);
  useEffect(() => () => {
    speakingUtterance.current = null;
    getBrowserSpeechAdapter()?.cancel();
  }, []);
  const speakVocabularyItem = (item: VocabularyItem) => {
    const adapter = getBrowserSpeechAdapter();
    const text = item.text || item.word;
    if (!adapter) { props.onNotify('当前浏览器不支持系统朗读'); return; }
    speakingUtterance.current = null;
    let utterance: SpeechSynthesisUtterance | null = null;
    const finish = () => { if (utterance && speakingUtterance.current === utterance) { speakingUtterance.current = null; setSpeakingItem(''); } };
    utterance = speakEnglish(text, adapter, finish, () => { finish(); props.onNotify('系统朗读未能启动'); });
    if (!utterance) return;
    speakingUtterance.current = utterance;
    setSpeakingItem(item.word);
  };
  const filtered = useMemo(() => {
    const term = props.query.trim().toLowerCase();
    return props.cues.map((cue, index) => ({ cue, index })).filter(({ cue }) => !term || `${cue.en} ${cue.zh || ''}`.toLowerCase().includes(term));
  }, [props.cues, props.query]);
  return <section className="learning-panel" aria-label="双语技术文章">
    <div className="panel-tabs">
      <button className={props.tab === 'transcript' ? 'active' : ''} onClick={() => props.setTab('transcript')}><BookOpen size={15} />双语字幕 <span>{props.cues.length}</span></button>
      <button className={props.tab === 'vocabulary' ? 'active' : ''} onClick={() => props.setTab('vocabulary')}><Library size={15} />生词本 <span>{props.vocabulary.length}</span></button>
    </div>
    {props.tab === 'transcript' ? <>
      <div className="transcript-toolbar"><div className="search-box"><Search size={14} /><input value={props.query} onChange={(event) => props.setQuery(event.target.value)} placeholder="搜索当前课时字幕" aria-label="搜索当前课时字幕" /></div><span className="language-pair">EN · 中文</span></div>
      <div className="transcript-head"><span>时间</span><span>English</span><span>中文 · {props.translationLabel}</span></div>
      <div className="transcript-list" aria-live="polite">
        {filtered.map(({ cue, index }) => <article className={`cue-row ${index === props.activeIndex ? 'active' : ''}`} key={cue.id} onClick={() => { if (phraseSelectionRef.current) { phraseSelectionRef.current = false; return; } props.onCue(index); }}>
          <button className="cue-time cue-play-button" onClick={(event) => { event.stopPropagation(); props.onCue(index); }} title="播放这一句" aria-label={`播放 ${formatTime(cue.start)} 的句子`}><Play size={11} fill="currentColor" />{formatTime(cue.start)}</button>
          <span className="cue-en" onMouseUp={(event) => { const selection = window.getSelection(); const range = selection?.rangeCount ? selection.getRangeAt(0) : null; const selected = selection?.toString().replace(/\s+/g, ' ').trim() || ''; if (!range || !event.currentTarget.contains(range.commonAncestorContainer) || selected.split(' ').length < 2) return; phraseSelectionRef.current = true; props.onPhraseSelection(selected, cue.id); }}><PhraseText text={cue.en} phrases={phrases.filter((item) => item.cueId === cue.id || !item.cueId)} saved={saved} onHover={(item, rect) => item.kind === 'phrase' ? props.onPhraseHover(item, rect) : props.onWordHover(item.word, rect)} onLeave={props.onWordLeave} onToggle={props.onWordToggle} /></span>
          <span className={`cue-zh ${cue.zh ? '' : 'translation-pending'}`}>{cue.zh || <button className="translate-cue-button" disabled={props.translatingCueIds.has(cue.id)} onClick={(event) => { event.stopPropagation(); props.onTranslate(cue.id); }}>{props.translatingCueIds.has(cue.id) ? <LoaderCircle className="spin" /> : <Languages />}{props.translatingCueIds.has(cue.id) ? '免费翻译中' : '免费翻译本句'}</button>}</span>
          {index === props.activeIndex && <span className="playing-bars" aria-hidden="true"><i /><i /><i /></span>}
        </article>)}
        {!filtered.length && <div className="empty-course compact"><Search /><strong>没有匹配的字幕</strong></div>}
      </div>
      {inspectedPhrase ? <div className="word-inspector phrase-inspector">
        <div className="word-title"><div><span>{inspectedPhrase.text}</span><small>短语 · 已收藏</small></div><div className="phrase-inspector-actions"><button onClick={() => props.onPhraseEdit(inspectedPhrase)} aria-label="编辑短语"><Pencil size={16} /></button><button onClick={() => props.onPhraseRemove(inspectedPhrase)} aria-label="移除短语"><Trash2 size={16} /></button></div></div>
        <p className="meaning">{inspectedPhrase.meaning || '暂无释义'}</p>
        {inspectedPhrase.note && <p className="usage"><Sparkles size={13} />{inspectedPhrase.note}</p>}
        {inspectedPhrase.example && <blockquote>{inspectedPhrase.example}</blockquote>}
      </div> : props.inspectedWord && <div className="word-inspector">
        <div className="word-title"><div><span>{props.inspectedWord}</span><small>{props.dictionary?.ipa} · {props.dictionary?.type}</small></div><button className={saved.has(props.inspectedWord) ? 'bookmarked' : ''} onClick={() => props.onWordToggle(props.inspectedWord)} aria-label={saved.has(props.inspectedWord) ? '移出生词本' : '加入生词本'}>{saved.has(props.inspectedWord) ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}</button></div>
        <p className="meaning">{props.dictionaryLoading ? '正在查词…' : props.dictionary?.meaning || '暂无释义'}</p>
        {props.dictionary?.note && <p className="usage"><Sparkles size={13} />{props.dictionary.note}</p>}
        {props.dictionary?.example && <blockquote>{props.dictionary.example}</blockquote>}
        {props.dictionary?.source && <small className="dictionary-source">来源：{props.dictionary.source}</small>}
      </div>}
    </> : <div className="vocabulary-layout">
      <div className="vocabulary-list">
        <div className="vocab-summary"><strong>{props.vocabulary.length}</strong><span>个学习项 · {Math.ceil(props.vocabulary.length / 10)} 组</span><button onClick={props.onReview} disabled={!props.vocabulary.length}><BrainCircuit size={14} />复习</button></div>
        {props.vocabulary.map((item) => <article className="vocab-item" key={`${item.kind}-${item.word}`}><button className={`vocab-speak ${speakingItem === item.word ? 'is-speaking' : ''}`} type="button" onClick={() => speakVocabularyItem(item)} aria-label={`朗读 ${item.text || item.word}`} aria-pressed={speakingItem === item.word}><Volume2 size={14} /><span><strong>{item.text || item.word}</strong><small>{item.kind === 'phrase' ? `短语 · 第 ${item.groupIndex + 1} 组` : `第 ${item.groupIndex + 1} 组`}</small></span></button><p>{item.kind === 'phrase' ? item.meaning : vocabularyMeanings[item.word] || item.meaning || '正在查词…'}</p><small className="vocab-review-meta">已复习 {item.reviewCount} 次</small><button className="vocab-complete" type="button" onClick={() => item.kind === 'phrase' ? props.onPhraseRemove(item) : props.onWordToggle(item.word)} aria-label={`完成 ${item.text || item.word} 并移出生词本`}>完成</button></article>)}
        {!props.vocabulary.length && <div className="empty-review"><Library /><strong>生词本还是空的</strong><span>点击字幕里的单词或拖选短语即可收藏。</span></div>}
      </div>
      <DictionaryWorkbench />
    </div>}
    {props.tooltip && props.inspectedWord && <div className={`dictionary-tooltip ${props.tooltip.above ? 'above' : ''}`} style={{ left: props.tooltip.x, top: props.tooltip.y }} role="tooltip"><div><strong>{props.inspectedWord}</strong><small>{props.dictionary?.ipa} {props.dictionary?.type}</small></div><p>{props.dictionaryLoading ? '正在查词…' : props.dictionary?.meaning || '暂无释义'}</p></div>}
  </section>;
}

function formatTime(seconds: number) { const mins = Math.floor(seconds / 60); const secs = Math.floor(seconds % 60); return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`; }

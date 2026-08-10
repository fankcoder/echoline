import { Bookmark, BookmarkCheck, BookOpen, BrainCircuit, Languages, Library, LoaderCircle, Play, Search, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import type { Cue, DictionaryEntry, VocabularyItem } from '../types';

function normalizeWord(value: string) { return value.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, ''); }

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

type Props = {
  cues: Cue[]; activeIndex: number; query: string; setQuery: (value: string) => void; onCue: (index: number) => void;
  vocabulary: VocabularyItem[]; tab: 'transcript' | 'vocabulary'; setTab: (tab: 'transcript' | 'vocabulary') => void;
  dictionary: DictionaryEntry | null; dictionaryLoading: boolean; inspectedWord: string;
  tooltip: { x: number; y: number; above: boolean } | null;
  onWordHover: (word: string, rect: DOMRect) => void; onWordLeave: () => void; onWordToggle: (word: string) => void;
  onTranslate: (cueId: string) => void; translatingCueIds: Set<string>; onReview: () => void; translationLabel: string;
};

export function TranscriptPanel(props: Props) {
  const saved = useMemo(() => new Set(props.vocabulary.map((item) => item.word)), [props.vocabulary]);
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
        {filtered.map(({ cue, index }) => <article className={`cue-row ${index === props.activeIndex ? 'active' : ''}`} key={cue.id} onClick={() => props.onCue(index)}>
          <button className="cue-time cue-play-button" onClick={(event) => { event.stopPropagation(); props.onCue(index); }} title="播放这一句" aria-label={`播放 ${formatTime(cue.start)} 的句子`}><Play size={11} fill="currentColor" />{formatTime(cue.start)}</button>
          <span className="cue-en"><WordText text={cue.en} saved={saved} onHover={props.onWordHover} onLeave={props.onWordLeave} onToggle={props.onWordToggle} /></span>
          <span className={`cue-zh ${cue.zh ? '' : 'translation-pending'}`}>{cue.zh || <button className="translate-cue-button" disabled={props.translatingCueIds.has(cue.id)} onClick={(event) => { event.stopPropagation(); props.onTranslate(cue.id); }}>{props.translatingCueIds.has(cue.id) ? <LoaderCircle className="spin" /> : <Languages />}{props.translatingCueIds.has(cue.id) ? '免费翻译中' : '免费翻译本句'}</button>}</span>
          {index === props.activeIndex && <span className="playing-bars" aria-hidden="true"><i /><i /><i /></span>}
        </article>)}
        {!filtered.length && <div className="empty-course compact"><Search /><strong>没有匹配的字幕</strong></div>}
      </div>
      {props.inspectedWord && <div className="word-inspector">
        <div className="word-title"><div><span>{props.inspectedWord}</span><small>{props.dictionary?.ipa} · {props.dictionary?.type}</small></div><button className={saved.has(props.inspectedWord) ? 'bookmarked' : ''} onClick={() => props.onWordToggle(props.inspectedWord)} aria-label={saved.has(props.inspectedWord) ? '移出生词本' : '加入生词本'}>{saved.has(props.inspectedWord) ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}</button></div>
        <p className="meaning">{props.dictionaryLoading ? '正在查词…' : props.dictionary?.meaning || '暂无释义'}</p>
        {props.dictionary?.note && <p className="usage"><Sparkles size={13} />{props.dictionary.note}</p>}
        {props.dictionary?.example && <blockquote>{props.dictionary.example}</blockquote>}
        {props.dictionary?.source && <small className="dictionary-source">来源：{props.dictionary.source}</small>}
      </div>}
    </> : <div className="vocabulary-list">
      <div className="vocab-summary"><strong>{props.vocabulary.length}</strong><span>个生词 · {Math.ceil(props.vocabulary.length / 10)} 组</span><button onClick={props.onReview} disabled={!props.vocabulary.length}><BrainCircuit size={14} />复习</button></div>
      {props.vocabulary.map((item) => <button className="vocab-item" key={item.word} onClick={() => props.onWordToggle(item.word)}><span><strong>{item.word}</strong><small>第 {item.groupIndex + 1} 组</small></span><p>已复习 {item.reviewCount} 次</p><BookmarkCheck size={15} /></button>)}
      {!props.vocabulary.length && <div className="empty-review"><Library /><strong>生词本还是空的</strong><span>点击字幕里的单词即可收藏。</span></div>}
    </div>}
    {props.tooltip && props.inspectedWord && <div className={`dictionary-tooltip ${props.tooltip.above ? 'above' : ''}`} style={{ left: props.tooltip.x, top: props.tooltip.y }} role="tooltip"><div><strong>{props.inspectedWord}</strong><small>{props.dictionary?.ipa} {props.dictionary?.type}</small></div><p>{props.dictionaryLoading ? '正在查词…' : props.dictionary?.meaning || '暂无释义'}</p></div>}
  </section>;
}

function formatTime(seconds: number) { const mins = Math.floor(seconds / 60); const secs = Math.floor(seconds % 60); return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`; }

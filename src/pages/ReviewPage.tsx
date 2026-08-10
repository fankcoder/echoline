import { ArrowLeft, BrainCircuit, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, jsonBody } from '../api';
import { useAppState } from '../state/AppState';
import type { DictionaryEntry, VocabularyItem } from '../types';

function shuffle<T>(items: T[]) { const copy = [...items]; for (let i = copy.length - 1; i > 0; i -= 1) { const target = Math.floor(Math.random() * (i + 1)); [copy[i], copy[target]] = [copy[target], copy[i]]; } return copy; }

export default function ReviewPage() {
  const { group = '0' } = useParams(); const navigate = useNavigate(); const { data, refresh, notify } = useAppState(); const groupIndex = Math.max(0, Number(group) || 0);
  const groups = useMemo(() => { const result: VocabularyItem[][] = []; for (let i = 0; i < data!.vocabulary.length; i += 10) result.push(data!.vocabulary.slice(i, i + 10)); return result; }, [data]);
  const [shuffleVersion, setShuffleVersion] = useState(0); const [position, setPosition] = useState(0); const [revealed, setRevealed] = useState(false); const [entry, setEntry] = useState<DictionaryEntry | null>(null);
  // shuffleVersion deliberately participates in the memoized deck seed.
  const deck = useMemo(() => { void shuffleVersion; return shuffle(groups[groupIndex] || []); }, [groups, groupIndex, shuffleVersion]);
  const reshuffle = () => { setShuffleVersion((value) => value + 1); setPosition(0); setRevealed(false); };
  const current = deck[position];
  useEffect(() => { if (current?.kind === 'word') void api<DictionaryEntry>(`/api/dictionary/${encodeURIComponent(current.word)}`).then(setEntry).catch(() => undefined); }, [current]);
  const finish = async () => { if (!deck.length) return; await api(`/api/review/${groupIndex}`, { method: 'POST', ...jsonBody({ items: deck.map((item) => ({ word: item.word, kind: item.kind })) }) }); await refresh(); notify(`第 ${groupIndex + 1} 组复习已记录`); reshuffle(); };
  return <main className="review-page"><header className="review-page-head"><button className="detail-command" onClick={() => navigate(data!.settings.currentLessonId ? `/learn/${data!.settings.currentLessonId}` : '/courses')}><ArrowLeft />返回学习</button><div><span className="eyebrow">Vocabulary Review</span><h1>生词复习</h1><p>每 10 个词为一组，每次进入组内顺序都会随机。</p></div></header>
    <section className="review-shell"><div className="review-toolbar"><div className="group-list">{groups.map((items, index) => <button className={index === groupIndex ? 'active' : ''} key={index} onClick={() => navigate(`/review/${index}`)}>第 {index + 1} 组 <small>{items.length}</small></button>)}</div><button className="reshuffle" onClick={reshuffle} aria-label="重新打乱"><RotateCcw /></button></div>
      {current ? <div className="review-session"><div className="review-progress"><span>第 {groupIndex + 1} 组</span><span>{position + 1} / {deck.length}</span></div><button className="flashcard" onClick={() => setRevealed(true)}><span className="flashcard-label">{current.kind === 'phrase' ? 'Phrase' : 'English'}</span><strong>{current.text || current.word}</strong><small>{current.kind === 'phrase' ? '短语' : entry?.word === current.word ? `${entry.ipa} ${entry.type}` : ''}</small>{revealed ? <div className="flashcard-answer"><p>{current.kind === 'phrase' ? current.meaning || '暂无释义' : entry?.word === current.word ? entry.meaning : '正在查询本地词典…'}</p>{current.kind === 'phrase' ? current.note && <blockquote>{current.note}</blockquote> : entry?.word === current.word && entry.note && <blockquote>{entry.note}</blockquote>}{current.kind === 'phrase' ? current.example && <em>{current.example}</em> : entry?.word === current.word && entry.example && <em>{entry.example}</em>}</div> : <span className="reveal-hint">点击卡片查看释义</span>}</button><div className="review-actions"><button className="secondary-button" disabled={position === 0} onClick={() => { setPosition((value) => value - 1); setRevealed(false); }}><ChevronLeft />上一个</button>{position < deck.length - 1 ? <button className="next-button" onClick={() => { setPosition((value) => value + 1); setRevealed(false); }}>下一个<ChevronRight /></button> : <button className="next-button" onClick={() => void finish()}><BrainCircuit />完成本组</button>}</div></div> : <div className="empty-review"><BrainCircuit /><strong>这一组还没有学习项</strong><span>先在字幕中点击单词或拖选短语加入生词本。</span></div>}
    </section>
  </main>;
}

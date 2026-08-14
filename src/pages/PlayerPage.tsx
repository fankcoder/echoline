import Hls from 'hls.js';
import { AlertCircle, ChevronLeft, ChevronRight, Eye, EyeOff, Import, Languages, LoaderCircle, Maximize, Pause, Play, RotateCcw, Save, SkipForward, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, jsonBody } from '../api';
import { TranscriptPanel } from '../components/TranscriptPanel';
import { YouTubePlayer, type YouTubePlayerHandle } from '../components/YouTubePlayer';
import { useAppState } from '../state/AppState';
import { normalizeRepeatCount, phaseAfterCue } from '../studyMode';
import type { DictionaryEntry, LessonManifest, VocabularyItem } from '../types';

type Phase = 'idle' | 'listening' | 'pause' | 'repeat' | 'ready';
type PhraseDraft = { normalized?: string; text: string; cueId: string | null; meaning: string; note: string; example: string };
const formatTime = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export default function PlayerPage() {
  const { lessonId = '' } = useParams(); const navigate = useNavigate();
  const { data, refresh, updateSettings, notify } = useAppState();
  const videoRef = useRef<HTMLVideoElement>(null); const youtubeRef = useRef<YouTubePlayerHandle>(null); const requestVersion = useRef(0); const hlsRef = useRef<Hls | null>(null);
  const lessonAbortRef = useRef<AbortController | null>(null); const activeLessonRef = useRef(lessonId);
  const phaseRef = useRef<Phase>('idle'); const activeRef = useRef(0); const handledEnd = useRef(false); const repeatIndexRef = useRef(0);
  const completedRef = useRef(new Set<string>()); const progressBase = useRef({ playback: 0, session: 0 }); const progressDelta = useRef({ playback: 0, session: 0 }); const lastMediaTime = useRef(0);
  const [manifest, setManifest] = useState<LessonManifest | null>(null); const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading'); const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false); const [buffering, setBuffering] = useState(false); const [currentTime, setCurrentTime] = useState(0); const [duration, setDuration] = useState(0);
  const [mediaReady, setMediaReady] = useState(false); const [playbackHint, setPlaybackHint] = useState('');
  const [activeIndex, setActiveIndex] = useState(0); const [phase, setPhaseState] = useState<Phase>('idle'); const [countdown, setCountdown] = useState(0); const [repeatIndex, setRepeatIndex] = useState(0); const [studyMode, setStudyMode] = useState(true);
  const [speed, setSpeed] = useState(1); const [volume, setVolume] = useState(.85); const [query, setQuery] = useState(''); const [tab, setTab] = useState<'transcript' | 'vocabulary'>('transcript');
  const [importUrl, setImportUrl] = useState(''); const [importing, setImporting] = useState(false); const [dictionary, setDictionary] = useState<DictionaryEntry | null>(null); const [dictionaryLoading, setDictionaryLoading] = useState(false); const [inspectedWord, setInspectedWord] = useState(''); const [tooltip, setTooltip] = useState<{ x: number; y: number; above: boolean } | null>(null);
  const [translatingCueIds, setTranslatingCueIds] = useState<Set<string>>(() => new Set());
  const [inspectedPhrase, setInspectedPhrase] = useState<VocabularyItem | null>(null); const [phraseDraft, setPhraseDraft] = useState<PhraseDraft | null>(null);
  const youtubeVideoId = manifest?.playback?.kind === 'youtube' ? manifest.playback.videoId : null;
  const isYouTubePlayback = Boolean(youtubeVideoId);

  activeLessonRef.current = lessonId;
  const setPhase = useCallback((next: Phase) => { phaseRef.current = next; setPhaseState(next); }, []);
  const preferredCourse = data!.courses.find((course) => course.id === data!.settings.selectedCourseId);
  const lessonCourse = data!.courses.find((course) => course.lessons.some((lesson) => lesson.id === lessonId));
  const selectedCourse = preferredCourse?.lessons.some((lesson) => lesson.id === lessonId) ? preferredCourse : lessonCourse || preferredCourse || data!.courses[0];
  const lessonIndex = selectedCourse?.lessons.findIndex((lesson) => lesson.id === lessonId) ?? -1;
  const videoHidden = Boolean(data!.settings.videoHidden); const waitSeconds = Number(data!.settings.waitSeconds || 3); const repeatCount = normalizeRepeatCount(data!.settings.repeatCount);

  const loadLesson = useCallback(async (id: string, force = false) => {
    lessonAbortRef.current?.abort(); const controller = new AbortController(); lessonAbortRef.current = controller;
    const version = ++requestVersion.current;
    videoRef.current?.pause(); youtubeRef.current?.pause(); hlsRef.current?.destroy(); hlsRef.current = null;
    setManifest(null); setStatus('loading'); setError(''); setQuery(''); setCurrentTime(0); setDuration(0); setMediaReady(false); setPlaybackHint(''); setActiveIndex(0); activeRef.current = 0; repeatIndexRef.current = 0; setRepeatIndex(0); setPhase('idle'); setCountdown(0); setTranslatingCueIds(new Set()); completedRef.current = new Set(); progressDelta.current = { playback: 0, session: 0 };
    try {
      let result = await api<LessonManifest>(force ? `/api/lessons/${id}/refresh` : `/api/lessons/${id}`, { method: force ? 'POST' : 'GET', signal: controller.signal });
      if ((!result.playback || result.lesson.importStatus !== 'ready') && !force) result = await api<LessonManifest>(`/api/lessons/${id}/refresh`, { method: 'POST', signal: controller.signal });
      if (version !== requestVersion.current || activeLessonRef.current !== id || result.lesson.id !== id) return;
      setManifest(result); setStatus('ready'); setActiveIndex(Math.min(result.progress.activeCue || 0, Math.max(0, result.cues.length - 1))); activeRef.current = result.progress.activeCue || 0;
      completedRef.current = new Set(result.progress.completedCueIds); progressBase.current = { playback: result.progress.playbackSeconds, session: result.progress.sessionSeconds }; lastMediaTime.current = result.progress.positionSeconds || 0;
      await updateSettings({ currentLessonId: id, selectedCourseId: selectedCourse?.id });
    } catch (reason) { if (version === requestVersion.current && (reason as Error).name !== 'AbortError') { setStatus('error'); setError((reason as Error).message); } }
  }, [selectedCourse?.id, setPhase, updateSettings]);

  useEffect(() => { void loadLesson(lessonId); return () => { requestVersion.current += 1; lessonAbortRef.current?.abort(); }; }, [lessonId, loadLesson]);

  const refreshPlayback = useCallback(async () => {
    setMediaReady(false); setBuffering(true); setPlaybackHint('视频暂时不可用，正在重新获取播放链接…');
    try {
      const next = await api<LessonManifest>(`/api/lessons/${lessonId}/refresh`, { method: 'POST' });
      if (activeLessonRef.current === lessonId && next.lesson.id === lessonId) setManifest(next);
    } catch {
      if (activeLessonRef.current === lessonId) { setBuffering(false); setPlaybackHint('视频暂时不可用，字幕仍可阅读。请稍后重新连接。'); }
    }
  }, [lessonId]);

  useEffect(() => {
    const video = videoRef.current; const playback = manifest?.playback; const mediaUrl = playback?.kind === 'hls' ? playback.mediaUrl : null;
    const startPosition = manifest?.progress.positionSeconds || 0; const lessonDuration = manifest?.lesson.duration || 0;
    if (!video || !mediaUrl) {
      if (!manifest?.playback) setMediaReady(false);
      return;
    }
    let refreshAttempted = false; video.pause(); video.removeAttribute('src'); video.load(); setIsPlaying(false); setBuffering(true); setMediaReady(false); setPlaybackHint('');
    const fail = (message: string) => { setMediaReady(false); setBuffering(false); setPlaybackHint(message); };
    const restore = () => { if (startPosition > 0 && startPosition < video.duration - 2) video.currentTime = startPosition; setDuration(video.duration || lessonDuration); };
    const ready = () => { setMediaReady(true); setBuffering(false); setPlaybackHint(''); };
    const onError = () => fail('视频暂时不可用，字幕仍可阅读。请重新连接后再播放。');
    video.addEventListener('loadedmetadata', restore); video.addEventListener('canplay', ready); video.addEventListener('error', onError);
    if (/\.m3u8(?:$|\?)/i.test(mediaUrl) && video.canPlayType('application/vnd.apple.mpegurl')) video.src = mediaUrl;
    else if (/\.m3u8(?:$|\?)/i.test(mediaUrl) && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, maxBufferLength: 30 }); hlsRef.current = hls; hls.loadSource(mediaUrl); hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_event, info) => {
        if (!info.fatal) return;
        if (info.type === Hls.ErrorTypes.NETWORK_ERROR && !refreshAttempted) { refreshAttempted = true; hls.startLoad(); }
        else if (info.type === Hls.ErrorTypes.MEDIA_ERROR && !refreshAttempted) { refreshAttempted = true; hls.recoverMediaError(); }
        else { hls.destroy(); fail('视频暂时不可用，正在重新获取播放链接…'); void refreshPlayback(); }
      });
    } else video.src = mediaUrl;
    return () => { video.removeEventListener('loadedmetadata', restore); video.removeEventListener('canplay', ready); video.removeEventListener('error', onError); hlsRef.current?.destroy(); hlsRef.current = null; };
  // Media must only be rebuilt when the playback token changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest?.playback, lessonId, refreshPlayback]);

  const pauseMedia = useCallback(() => {
    if (isYouTubePlayback) youtubeRef.current?.pause();
    else videoRef.current?.pause();
  }, [isYouTubePlayback]);
  const seekMedia = useCallback((seconds: number) => {
    if (isYouTubePlayback) youtubeRef.current?.seek(seconds);
    else if (videoRef.current) videoRef.current.currentTime = seconds;
  }, [isYouTubePlayback]);
  const playMedia = useCallback(() => {
    if (isYouTubePlayback) {
      if (!youtubeRef.current) return Promise.reject(new Error('YouTube 播放器尚未就绪'));
      youtubeRef.current.play();
      return Promise.resolve();
    }
    return videoRef.current?.play() || Promise.reject(new Error('视频播放器尚未就绪'));
  }, [isYouTubePlayback]);
  const mediaCanPlay = useCallback(() => isYouTubePlayback || Boolean(videoRef.current && videoRef.current.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA), [isYouTubePlayback]);

  const playCue = useCallback((index: number, nextPhase: Phase = 'listening') => {
    const cue = manifest?.cues[index]; if (!cue) return;
    activeRef.current = index; setActiveIndex(index); handledEnd.current = false;
    if (!mediaReady || !mediaCanPlay()) {
      setPhase('idle'); setPlaybackHint(manifest?.playback ? '视频正在缓冲，字幕已就绪；请稍候再点击本句播放。' : '正在获取视频播放链接，字幕可以先阅读。');
      return;
    }
    if (nextPhase === 'listening') { repeatIndexRef.current = 0; setRepeatIndex(0); }
    setPhase(nextPhase); seekMedia(cue.start + .02);
    void playMedia().catch(() => { setPhase('idle'); setPlaybackHint(mediaCanPlay() ? '视频暂时无法开始播放，请稍后重试。' : '视频正在缓冲，字幕已就绪；请稍候再点击本句播放。'); });
  }, [manifest?.cues, manifest?.playback, mediaCanPlay, mediaReady, playMedia, seekMedia, setPhase]);

  const onMediaTimeUpdate = useCallback((time: number) => {
    if (!manifest) return; setCurrentTime(time);
    const delta = time - lastMediaTime.current; if (isPlaying && delta > 0 && delta < 2.5) progressDelta.current.playback += delta; lastMediaTime.current = time;
    const found = manifest.cues.findIndex((cue) => time >= cue.start && time < cue.end);
    if (!studyMode && found >= 0 && found !== activeRef.current) { activeRef.current = found; setActiveIndex(found); }
    const cue = manifest.cues[activeRef.current];
    if (studyMode && cue && ['listening', 'repeat'].includes(phaseRef.current) && time >= cue.end - .04 && !handledEnd.current) {
      handledEnd.current = true; pauseMedia(); completedRef.current.add(cue.id);
      const nextPhase = phaseAfterCue(phaseRef.current as 'listening' | 'repeat', repeatIndexRef.current, repeatCount);
      setPhase(nextPhase); setCountdown(nextPhase === 'pause' ? waitSeconds : 0);
    }
  }, [isPlaying, manifest, pauseMedia, repeatCount, studyMode, waitSeconds, setPhase]);

  useEffect(() => {
    if (phase !== 'pause') return;
    if (repeatIndexRef.current >= repeatCount) { setPhase('ready'); setCountdown(0); return; }
    if (countdown <= 0) { repeatIndexRef.current += 1; setRepeatIndex(repeatIndexRef.current); playCue(activeRef.current, 'repeat'); return; }
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000); return () => window.clearTimeout(timer);
  }, [phase, countdown, playCue, repeatCount, setPhase]);

  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible' && (isPlaying || phaseRef.current === 'pause')) progressDelta.current.session += 1; }, 1000);
    return () => window.clearInterval(timer);
  }, [isPlaying]);

  const persistProgress = useCallback(() => {
    return api(`/api/lessons/${lessonId}/progress`, { method: 'PATCH', ...jsonBody({ playbackSeconds: progressBase.current.playback + progressDelta.current.playback, sessionSeconds: progressBase.current.session + progressDelta.current.session, positionSeconds: lastMediaTime.current, activeCue: activeRef.current, completedCueIds: [...completedRef.current] }) }).then(() => undefined).catch(() => undefined);
  }, [lessonId]);
  useEffect(() => { if (!manifest) return; const timer = window.setInterval(() => void persistProgress(), 30_000); return () => { window.clearInterval(timer); void persistProgress(); void refresh(); }; }, [manifest, persistProgress, refresh]);

  const togglePlay = () => {
    if (!manifest?.playback) return;
    if (isPlaying) { pauseMedia(); return; }
    if (!mediaReady || !mediaCanPlay()) { setPlaybackHint('视频正在缓冲，字幕已就绪；请稍候再点击播放。'); return; }
    if (studyMode && manifest.cues.length && ['idle', 'ready'].includes(phaseRef.current)) { playCue(activeRef.current); return; }
    void playMedia().catch(() => setPlaybackHint('视频暂时无法开始播放，请稍后重试。'));
  };
  const goEpisode = (offset: number) => { const target = selectedCourse?.lessons[lessonIndex + offset]; if (target) { void persistProgress(); navigate(`/learn/${target.id}`); } };
  const changeCourse = (courseId: string) => { const course = data!.courses.find((item) => item.id === courseId); if (course?.lessons[0]) { void updateSettings({ selectedCourseId: course.id }); navigate(`/learn/${course.lessons[0].id}`); } else notify('这个课程还没有学习内容'); };

  const importLesson = async () => {
    if (!importUrl.trim()) return; setImporting(true);
    try { const result = await api<LessonManifest>('/api/lessons/resolve', { method: 'POST', ...jsonBody({ sourceUrl: importUrl.trim() }) }); if (selectedCourse) await api(`/api/courses/${selectedCourse.id}/lessons`, { method: 'POST', ...jsonBody({ sourceUrl: result.lesson.sourceUrl, lessonId: result.lesson.id }) }); await refresh(); notify('课时、媒体和英文字幕已导入'); navigate(`/learn/${result.lesson.id}`); setImportUrl(''); }
    catch (reason) { notify((reason as Error).message); } finally { setImporting(false); }
  };

  const dictionaryAbort = useRef<AbortController | null>(null);
  const inspectWord = (word: string, rect: DOMRect) => {
    dictionaryAbort.current?.abort(); const controller = new AbortController(); dictionaryAbort.current = controller; setInspectedPhrase(null); setInspectedWord(word); setDictionary(null); setDictionaryLoading(true); const above = rect.bottom + 100 > window.innerHeight; setTooltip({ x: Math.max(150, Math.min(window.innerWidth - 150, rect.left + rect.width / 2)), y: above ? rect.top - 8 : rect.bottom + 8, above });
    void api<DictionaryEntry>(`/api/dictionary/${encodeURIComponent(word)}`, { signal: controller.signal }).then(setDictionary).catch((reason) => { if ((reason as Error).name !== 'AbortError') setDictionary({ word, ipa: '', type: '', meaning: '词典中暂无释义', note: '', example: '', audio: '', source: '' }); }).finally(() => setDictionaryLoading(false));
  };
  const toggleWord = async (word: string) => { await api('/api/vocabulary/toggle', { method: 'POST', ...jsonBody({ word, lessonId, cueId: manifest?.cues[activeRef.current]?.id }) }); await refresh(); };
  const inspectPhrase = (phrase: VocabularyItem, rect: DOMRect) => { dictionaryAbort.current?.abort(); setInspectedWord(''); setDictionary(null); setDictionaryLoading(false); setInspectedPhrase(phrase); const above = rect.bottom + 170 > window.innerHeight; setTooltip({ x: Math.max(170, Math.min(window.innerWidth - 170, rect.left + rect.width / 2)), y: above ? rect.top - 8 : rect.bottom + 8, above }); };
  const selectPhrase = (text: string, cueId: string) => {
    const existing = data!.vocabulary.find((item) => item.kind === 'phrase' && item.word === text.toLowerCase().replace(/\s+/g, ' ').trim());
    setInspectedPhrase(null); setTooltip(null); setPhraseDraft(existing ? { normalized: existing.word, text: existing.text, cueId: existing.cueId, meaning: existing.meaning, note: existing.note, example: existing.example } : { text, cueId, meaning: '', note: '', example: '' });
    window.getSelection()?.removeAllRanges();
  };
  const savePhrase = async (draft: PhraseDraft) => {
    const body = { phrase: draft.text, meaning: draft.meaning, note: draft.note, example: draft.example, lessonId, cueId: draft.cueId };
    try { await api(draft.normalized ? `/api/phrases/${encodeURIComponent(draft.normalized)}` : '/api/phrases', { method: draft.normalized ? 'PATCH' : 'POST', ...jsonBody(body) }); await refresh(); setPhraseDraft(null); notify(draft.normalized ? '短语已更新' : '短语已加入生词本'); }
    catch (reason) { notify((reason as Error).message); }
  };
  const removePhrase = async (phrase: VocabularyItem) => { try { await api(`/api/phrases/${encodeURIComponent(phrase.word)}`, { method: 'DELETE' }); await refresh(); setInspectedPhrase(null); setTooltip(null); notify('短语已移除'); } catch (reason) { notify((reason as Error).message); } };
  const editPhrase = (phrase: VocabularyItem) => setPhraseDraft({ normalized: phrase.word, text: phrase.text, cueId: phrase.cueId, meaning: phrase.meaning, note: phrase.note, example: phrase.example });
  const translateSentence = async (cueId: string) => {
    const current = manifest; if (!current || current.cues.find((item) => item.id === cueId)?.zh || translatingCueIds.has(cueId)) return;
    setTranslatingCueIds((ids) => new Set(ids).add(cueId));
    try {
      const next = await api<LessonManifest>(`/api/lessons/${lessonId}/translations/${encodeURIComponent(cueId)}`, { method: 'POST' });
      if (activeLessonRef.current === lessonId && next.lesson.id === lessonId && next.lesson.manifestRevision === current.lesson.manifestRevision) setManifest(next);
    } catch (reason) { notify((reason as Error).message); }
    finally { setTranslatingCueIds((ids) => { const next = new Set(ids); next.delete(cueId); return next; }); }
  };
  const translatedCount = manifest?.cues.filter((item) => item.zh).length || 0;
  const translationLabel = manifest?.captionSource === 'official' ? '官方' : `${translatedCount} 条已缓存 · 免费按需`;

  if (status === 'loading') return <main className="lesson-loading" aria-live="polite"><LoaderCircle className="spin" /><strong>正在切换课时</strong><span>旧字幕已经清除，正在加载本集媒体和字幕…</span></main>;
  if (status === 'error' || !manifest) return <main className="lesson-loading error-state"><AlertCircle /><strong>本课时暂时无法打开</strong><span>{error}</span><button onClick={() => void loadLesson(lessonId, true)}><RotateCcw size={15} />重新解析</button></main>;
  const cue = manifest.cues[activeIndex];
  return <main className="workspace">
      <TranscriptPanel cues={manifest.cues} activeIndex={activeIndex} query={query} setQuery={setQuery} onCue={(index) => playCue(index)} vocabulary={data!.vocabulary} tab={tab} setTab={setTab} dictionary={dictionary} dictionaryLoading={dictionaryLoading} inspectedWord={inspectedWord} inspectedPhrase={inspectedPhrase} tooltip={tooltip} onWordHover={inspectWord} onWordLeave={() => setTooltip(null)} onWordToggle={(word) => void toggleWord(word)} onPhraseHover={inspectPhrase} onPhraseSelection={selectPhrase} onPhraseRemove={(phrase) => void removePhrase(phrase)} onPhraseEdit={editPhrase} onTranslate={(cueId) => void translateSentence(cueId)} translatingCueIds={translatingCueIds} onReview={() => navigate('/learn/review/0')} onNotify={notify} translationLabel={translationLabel} />
      <section className="player-column">
        <div className="player-import"><input value={importUrl} onChange={(event) => setImportUrl(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void importLesson()} placeholder="粘贴 DeepLearning.AI 或 YouTube 视频网址" aria-label="课程网址" /><button onClick={() => void importLesson()} disabled={importing}>{importing ? <LoaderCircle className="spin" /> : <Import size={15} />}{importing ? '解析中' : '导入'}</button></div>
        <div className="lesson-heading"><div><span className="eyebrow">{selectedCourse?.name || '未分类课程'} · 第 {lessonIndex + 1} 集</span><h1>{manifest.lesson.title}</h1></div><div className="lesson-side"><div className="course-actions"><select value={selectedCourse?.id || ''} onChange={(event) => changeCourse(event.target.value)} aria-label="选择课程">{data!.courses.map((course) => <option value={course.id} key={course.id}>{course.name} ({course.lessons.length})</option>)}</select><button className="save-course-button" onClick={async () => { if (!selectedCourse) return; await api(`/api/courses/${selectedCourse.id}/lessons`, { method: 'POST', ...jsonBody({ sourceUrl: manifest.lesson.sourceUrl, lessonId: manifest.lesson.id }) }); await refresh(); notify('已保存到课程，重复内容不会再次添加'); }}><Save size={14} />保存到课程</button></div><div className="episode-navigation"><button disabled={lessonIndex <= 0} onClick={() => goEpisode(-1)}><ChevronLeft size={15} />上一集</button><span>{lessonIndex >= 0 ? `${lessonIndex + 1} / ${selectedCourse.lessons.length}` : '未加入课程'}</span><button disabled={lessonIndex < 0 || lessonIndex >= selectedCourse.lessons.length - 1} onClick={() => goEpisode(1)}>下一集<ChevronRight size={15} /></button></div></div></div>
        <div className={`video-stage ${videoHidden ? 'video-hidden' : ''}`}>
          {youtubeVideoId
            ? <YouTubePlayer ref={youtubeRef} videoId={youtubeVideoId} startAt={manifest.progress.positionSeconds} onReady={(nextDuration) => { youtubeRef.current?.setVolume(volume); youtubeRef.current?.setPlaybackRate(speed); setDuration(nextDuration || manifest.lesson.duration || 0); setMediaReady(true); setBuffering(false); setPlaybackHint(''); }} onTimeUpdate={onMediaTimeUpdate} onPlaying={() => { setIsPlaying(true); setBuffering(false); setMediaReady(true); setPlaybackHint(''); }} onPaused={() => setIsPlaying(false)} onBuffering={() => setBuffering(true)} onEnded={() => setIsPlaying(false)} onError={() => { setIsPlaying(false); setBuffering(false); setMediaReady(false); setPlaybackHint('YouTube 视频暂时无法播放，请稍后重试。'); }} />
            : <video ref={videoRef} crossOrigin="anonymous" playsInline onClick={togglePlay} onTimeUpdate={(event) => onMediaTimeUpdate(event.currentTarget.currentTime)} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onWaiting={() => { setBuffering(true); setMediaReady(false); }} onPlaying={() => { setIsPlaying(true); setBuffering(false); setMediaReady(true); setPlaybackHint(''); }} />}
          {videoHidden && <button className="audio-only" onClick={togglePlay}><EyeOff /><span>仅听音频</span><strong>{manifest.lesson.title}</strong></button>}
          {!videoHidden && !isPlaying && !buffering && <button className="big-play" onClick={togglePlay} aria-label="播放"><Play fill="currentColor" /></button>}
          {buffering && <div className="stage-status"><LoaderCircle className="spin" />缓冲中</div>}
          {phase !== 'idle' && <div className={`stage-status ${phase === 'pause' ? 'counting' : ''}`}>{phase === 'pause' ? <><span className="countdown-number">{countdown}</span>复述原句 · 下一次 {repeatIndex + 1}/{repeatCount}</> : phase === 'repeat' ? `重复原句 ${repeatIndex}/${repeatCount}` : ({ listening: '听原句', ready: '点击下一句' } as Record<string,string>)[phase]}</div>}
        </div>
        <div className="transport"><button className="play-button" onClick={togglePlay} aria-label={isPlaying ? '暂停' : '播放'}>{isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button><span className="timecode">{formatTime(currentTime)} / {formatTime(duration || manifest.lesson.duration || 0)}</span><input className="timeline" type="range" min="0" max={duration || manifest.lesson.duration || 0} step="0.1" value={currentTime} onChange={(event) => { const time = Number(event.target.value); seekMedia(time); setCurrentTime(time); lastMediaTime.current = time; }} aria-label="播放进度" /><Volume2 className="volume-icon" size={16} /><input className="volume" type="range" min="0" max="1" step=".05" value={volume} onChange={(event) => { const value = Number(event.target.value); setVolume(value); if (isYouTubePlayback) youtubeRef.current?.setVolume(value); else if (videoRef.current) videoRef.current.volume = value; }} aria-label="音量" /><button className="speed-button" onClick={() => { const values = [.75, 1, 1.25, 1.5, 2]; const next = values[(values.indexOf(speed) + 1) % values.length]; setSpeed(next); if (isYouTubePlayback) youtubeRef.current?.setPlaybackRate(next); else if (videoRef.current) videoRef.current.playbackRate = next; }}>{speed}×</button><button className="icon-button" onClick={() => void updateSettings({ videoHidden: !videoHidden })} aria-label={videoHidden ? '显示视频' : '隐藏视频'}>{videoHidden ? <Eye /> : <EyeOff />}</button><button className="icon-button" onClick={() => { if (isYouTubePlayback) youtubeRef.current?.requestFullscreen(); else void videoRef.current?.requestFullscreen(); }} aria-label="全屏"><Maximize /></button></div>
        {playbackHint && <div className="media-playback-notice" role="status" aria-live="polite">{buffering && <LoaderCircle className="spin" size={14} />}<span>{playbackHint}</span>{!buffering && <button onClick={() => void refreshPlayback()}><RotateCcw size={13} />重新连接</button>}</div>}
        <div className="study-bar"><label className="mode-toggle"><input type="checkbox" checked={studyMode} onChange={(event) => { setStudyMode(event.target.checked); repeatIndexRef.current = 0; setRepeatIndex(0); setPhase('idle'); }} /><span className="toggle-track"><span /></span><span><strong>学习模式</strong><small>听一句 · 复述 · 重复 {repeatCount} 次</small></span></label><div className="wait-setting" title="复述时间"><span>复述时间</span><button disabled={waitSeconds <= 1} aria-label="减少复述时间" onClick={() => void updateSettings({ waitSeconds: Math.max(1, waitSeconds - 1) })}>−</button><strong>{waitSeconds}s</strong><button disabled={waitSeconds >= 15} aria-label="增加复述时间" onClick={() => void updateSettings({ waitSeconds: Math.min(15, waitSeconds + 1) })}>+</button></div><div className="wait-setting repeat-setting" title="重复次数"><span>重复次数</span><button disabled={repeatCount <= 0} aria-label="减少重复次数" onClick={() => void updateSettings({ repeatCount: Math.max(0, repeatCount - 1) })}>−</button><strong>{repeatCount}次</strong><button disabled={repeatCount >= 9} aria-label="增加重复次数" onClick={() => void updateSettings({ repeatCount: Math.min(9, repeatCount + 1) })}>+</button></div><div className="study-actions"><button className="secondary-button" disabled={activeIndex <= 0} onClick={() => playCue(activeIndex - 1)}><RotateCcw size={14} />上一句</button><button className="next-button" disabled={activeIndex >= manifest.cues.length - 1} onClick={() => playCue(activeIndex + 1)}><SkipForward size={14} />下一句</button></div></div>
        <div className="current-sentence"><div className="sentence-kicker"><Languages size={14} />当前句 · {activeIndex + 1}/{manifest.cues.length} · {translationLabel}</div><div className="sentence-grid"><div className="sentence-en"><p>{cue?.en || '本集没有可用的英文字幕'}</p></div><div className="sentence-zh">{cue?.zh ? <p>{cue.zh}</p> : cue && <button className="translate-cue-button" disabled={translatingCueIds.has(cue.id)} onClick={() => void translateSentence(cue.id)}>{translatingCueIds.has(cue.id) ? <LoaderCircle className="spin" /> : <Languages />}{translatingCueIds.has(cue.id) ? '免费翻译中' : '免费翻译本句'}</button>}</div></div></div>
      </section>
      <PhraseModal draft={phraseDraft} onClose={() => setPhraseDraft(null)} onSave={(draft) => void savePhrase(draft)} />
    </main>;
}

function PhraseModal({ draft, onClose, onSave }: { draft: PhraseDraft | null; onClose: () => void; onSave: (draft: PhraseDraft) => void }) {
  const [form, setForm] = useState<PhraseDraft | null>(draft);
  useEffect(() => { setForm(draft); }, [draft]);
  useEffect(() => { if (!draft) return; const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose(); window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown); }, [draft, onClose]);
  if (!form) return null;
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="phrase-modal" onSubmit={(event) => { event.preventDefault(); if (form.meaning.trim()) onSave({ ...form, text: form.text.trim(), meaning: form.meaning.trim() }); }} role="dialog" aria-modal="true" aria-labelledby="phrase-modal-title">
    <div className="modal-head"><div><span>Phrase Notebook</span><strong id="phrase-modal-title">{form.normalized ? '编辑短语' : '添加短语'}</strong></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭">×</button></div>
    <div className="phrase-form"><label><span>英文短语</span><input value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} required /></label><label><span>中文释义</span><input autoFocus={!form.normalized} value={form.meaning} onChange={(event) => setForm({ ...form, meaning: event.target.value })} placeholder="例如：处于前沿；最先进" required /></label><label><span>用法说明（可选）</span><textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label><label><span>例句（可选）</span><textarea value={form.example} onChange={(event) => setForm({ ...form, example: event.target.value })} /></label></div>
    <div className="confirm-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="next-button" disabled={!form.text.trim() || !form.meaning.trim()}>保存短语</button></div>
  </form></div>;
}

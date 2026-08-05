import Hls from 'hls.js';
import { AlertCircle, ChevronLeft, ChevronRight, Eye, EyeOff, Import, Languages, LoaderCircle, Maximize, Pause, Play, RotateCcw, Save, SkipForward, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, jsonBody } from '../api';
import { TranscriptPanel } from '../components/TranscriptPanel';
import { useAppState } from '../state/AppState';
import type { DictionaryEntry, LessonManifest } from '../types';

type Phase = 'idle' | 'listening' | 'pause' | 'repeat' | 'ready';
const formatTime = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export default function PlayerPage() {
  const { lessonId = '' } = useParams(); const navigate = useNavigate();
  const { data, refresh, updateSettings, notify } = useAppState();
  const videoRef = useRef<HTMLVideoElement>(null); const requestVersion = useRef(0); const hlsRef = useRef<Hls | null>(null);
  const lessonAbortRef = useRef<AbortController | null>(null);
  const phaseRef = useRef<Phase>('idle'); const activeRef = useRef(0); const handledEnd = useRef(false);
  const completedRef = useRef(new Set<string>()); const progressBase = useRef({ playback: 0, session: 0 }); const progressDelta = useRef({ playback: 0, session: 0 }); const lastMediaTime = useRef(0);
  const [manifest, setManifest] = useState<LessonManifest | null>(null); const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading'); const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false); const [buffering, setBuffering] = useState(false); const [currentTime, setCurrentTime] = useState(0); const [duration, setDuration] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0); const [phase, setPhaseState] = useState<Phase>('idle'); const [countdown, setCountdown] = useState(0); const [studyMode, setStudyMode] = useState(true);
  const [speed, setSpeed] = useState(1); const [volume, setVolume] = useState(.85); const [query, setQuery] = useState(''); const [tab, setTab] = useState<'transcript' | 'vocabulary'>('transcript');
  const [importUrl, setImportUrl] = useState(''); const [importing, setImporting] = useState(false); const [dictionary, setDictionary] = useState<DictionaryEntry | null>(null); const [dictionaryLoading, setDictionaryLoading] = useState(false); const [inspectedWord, setInspectedWord] = useState(''); const [tooltip, setTooltip] = useState<{ x: number; y: number; above: boolean } | null>(null);

  const setPhase = useCallback((next: Phase) => { phaseRef.current = next; setPhaseState(next); }, []);
  const selectedCourse = data!.courses.find((course) => course.id === data!.settings.selectedCourseId) || data!.courses.find((course) => course.lessons.some((lesson) => lesson.id === lessonId)) || data!.courses[0];
  const lessonIndex = selectedCourse?.lessons.findIndex((lesson) => lesson.id === lessonId) ?? -1;
  const videoHidden = Boolean(data!.settings.videoHidden); const waitSeconds = Number(data!.settings.waitSeconds || 3);

  const loadLesson = useCallback(async (id: string, force = false) => {
    lessonAbortRef.current?.abort(); const controller = new AbortController(); lessonAbortRef.current = controller;
    const version = ++requestVersion.current;
    videoRef.current?.pause(); hlsRef.current?.destroy(); hlsRef.current = null;
    setManifest(null); setStatus('loading'); setError(''); setQuery(''); setCurrentTime(0); setDuration(0); setActiveIndex(0); activeRef.current = 0; setPhase('idle'); setCountdown(0); completedRef.current = new Set(); progressDelta.current = { playback: 0, session: 0 };
    try {
      let result = await api<LessonManifest>(force ? `/api/lessons/${id}/refresh` : `/api/lessons/${id}`, { method: force ? 'POST' : 'GET', signal: controller.signal });
      if ((!result.playback || result.lesson.importStatus !== 'ready') && !force) result = await api<LessonManifest>(`/api/lessons/${id}/refresh`, { method: 'POST', signal: controller.signal });
      if (version !== requestVersion.current) return;
      setManifest(result); setStatus('ready'); setActiveIndex(Math.min(result.progress.activeCue || 0, Math.max(0, result.cues.length - 1))); activeRef.current = result.progress.activeCue || 0;
      completedRef.current = new Set(result.progress.completedCueIds); progressBase.current = { playback: result.progress.playbackSeconds, session: result.progress.sessionSeconds }; lastMediaTime.current = result.progress.positionSeconds || 0;
      await updateSettings({ currentLessonId: id, selectedCourseId: selectedCourse?.id });
    } catch (reason) { if (version === requestVersion.current && (reason as Error).name !== 'AbortError') { setStatus('error'); setError((reason as Error).message); } }
  }, [selectedCourse?.id, setPhase, updateSettings]);

  useEffect(() => { void loadLesson(lessonId); return () => { requestVersion.current += 1; lessonAbortRef.current?.abort(); }; }, [lessonId, loadLesson]);

  useEffect(() => {
    const video = videoRef.current; const mediaUrl = manifest?.playback?.mediaUrl;
    if (!video || !mediaUrl) return;
    let refreshAttempted = false; video.pause(); video.removeAttribute('src'); video.load(); setIsPlaying(false); setBuffering(true);
    const fail = (message: string) => { setError(message); setStatus('error'); };
    const restore = () => { if (manifest.progress.positionSeconds > 0 && manifest.progress.positionSeconds < video.duration - 2) video.currentTime = manifest.progress.positionSeconds; setDuration(video.duration || manifest.lesson.duration || 0); setBuffering(false); };
    const onError = () => fail('媒体加载失败；链接可能已过期，可以重新解析后重试。');
    video.addEventListener('loadedmetadata', restore); video.addEventListener('error', onError);
    if (/\.m3u8(?:$|\?)/i.test(mediaUrl) && video.canPlayType('application/vnd.apple.mpegurl')) video.src = mediaUrl;
    else if (/\.m3u8(?:$|\?)/i.test(mediaUrl) && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, maxBufferLength: 30 }); hlsRef.current = hls; hls.loadSource(mediaUrl); hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_event, info) => {
        if (!info.fatal) return;
        if (info.type === Hls.ErrorTypes.NETWORK_ERROR && !refreshAttempted) { refreshAttempted = true; hls.startLoad(); }
        else if (info.type === Hls.ErrorTypes.MEDIA_ERROR && !refreshAttempted) { refreshAttempted = true; hls.recoverMediaError(); }
        else { hls.destroy(); void loadLesson(lessonId, true); }
      });
    } else video.src = mediaUrl;
    return () => { video.removeEventListener('loadedmetadata', restore); video.removeEventListener('error', onError); hlsRef.current?.destroy(); hlsRef.current = null; };
  // Media must only be rebuilt when the playback token changes; translation polling must not reload video.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest?.playback?.mediaUrl, lessonId, loadLesson]);

  useEffect(() => {
    if (!manifest || !['running', 'idle'].includes(manifest.lesson.translationStatus)) return;
    const timer = window.setInterval(async () => { try { const next = await api<LessonManifest>(`/api/lessons/${lessonId}`); if (requestVersion.current && next.lesson.id === lessonId) setManifest(next); } catch { /* player remains available in English */ } }, 1800);
    return () => window.clearInterval(timer);
  // Polling intentionally keys off status rather than the entire manifest to avoid restarting on every progress response.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId, manifest?.lesson.translationStatus]);

  const playCue = useCallback((index: number, nextPhase: Phase = 'listening') => {
    const video = videoRef.current; const cue = manifest?.cues[index]; if (!video || !cue) return;
    activeRef.current = index; setActiveIndex(index); handledEnd.current = false; setPhase(nextPhase); video.currentTime = cue.start + .02;
    video.play().catch((reason: Error) => { setError(`浏览器阻止了播放：${reason.message}`); setStatus('error'); });
  }, [manifest?.cues, setPhase]);

  const onTimeUpdate = useCallback(() => {
    const video = videoRef.current; if (!video || !manifest) return; const time = video.currentTime; setCurrentTime(time);
    const delta = time - lastMediaTime.current; if (!video.paused && delta > 0 && delta < 2.5) progressDelta.current.playback += delta; lastMediaTime.current = time;
    const found = manifest.cues.findIndex((cue) => time >= cue.start && time < cue.end);
    if (!studyMode && found >= 0 && found !== activeRef.current) { activeRef.current = found; setActiveIndex(found); }
    const cue = manifest.cues[activeRef.current];
    if (studyMode && cue && ['listening', 'repeat'].includes(phaseRef.current) && time >= cue.end - .04 && !handledEnd.current) {
      handledEnd.current = true; video.pause(); completedRef.current.add(cue.id);
      if (phaseRef.current === 'repeat') setPhase('ready'); else { setPhase('pause'); setCountdown(waitSeconds); }
    }
  }, [manifest, studyMode, waitSeconds, setPhase]);

  useEffect(() => {
    if (phase !== 'pause') return; if (countdown <= 0) { playCue(activeRef.current, 'repeat'); return; }
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000); return () => window.clearTimeout(timer);
  }, [phase, countdown, playCue]);

  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible' && (isPlaying || phaseRef.current === 'pause')) progressDelta.current.session += 1; }, 1000);
    return () => window.clearInterval(timer);
  }, [isPlaying]);

  const persistProgress = useCallback(() => {
    const video = videoRef.current;
    return api(`/api/lessons/${lessonId}/progress`, { method: 'PATCH', ...jsonBody({ playbackSeconds: progressBase.current.playback + progressDelta.current.playback, sessionSeconds: progressBase.current.session + progressDelta.current.session, positionSeconds: video?.currentTime || lastMediaTime.current, activeCue: activeRef.current, completedCueIds: [...completedRef.current] }) }).then(() => undefined).catch(() => undefined);
  }, [lessonId]);
  useEffect(() => { if (!manifest) return; const timer = window.setInterval(() => void persistProgress(), 10_000); return () => { window.clearInterval(timer); void persistProgress(); void refresh(); }; }, [manifest, persistProgress, refresh]);

  const togglePlay = () => { const video = videoRef.current; if (!video || !manifest?.cues.length) return; if (video.paused) { if (studyMode && ['idle', 'ready'].includes(phaseRef.current)) playCue(activeRef.current); else video.play().catch((reason: Error) => setError(reason.message)); } else video.pause(); };
  const goEpisode = (offset: number) => { const target = selectedCourse?.lessons[lessonIndex + offset]; if (target) { void persistProgress(); navigate(`/learn/${target.id}`); } };
  const changeCourse = (courseId: string) => { const course = data!.courses.find((item) => item.id === courseId); if (course?.lessons[0]) { void updateSettings({ selectedCourseId: course.id }); navigate(`/learn/${course.lessons[0].id}`); } else notify('这个课程还没有学习内容'); };

  const importLesson = async () => {
    if (!importUrl.trim()) return; setImporting(true);
    try { const result = await api<LessonManifest>('/api/lessons/resolve', { method: 'POST', ...jsonBody({ sourceUrl: importUrl.trim() }) }); if (selectedCourse) await api(`/api/courses/${selectedCourse.id}/lessons`, { method: 'POST', ...jsonBody({ sourceUrl: result.lesson.sourceUrl, lessonId: result.lesson.id }) }); await refresh(); notify('课时、媒体和英文字幕已导入'); navigate(`/learn/${result.lesson.id}`); setImportUrl(''); }
    catch (reason) { notify((reason as Error).message); } finally { setImporting(false); }
  };

  const dictionaryAbort = useRef<AbortController | null>(null);
  const inspectWord = (word: string, rect: DOMRect) => {
    dictionaryAbort.current?.abort(); const controller = new AbortController(); dictionaryAbort.current = controller; setInspectedWord(word); setDictionary(null); setDictionaryLoading(true); const above = rect.bottom + 100 > window.innerHeight; setTooltip({ x: Math.max(150, Math.min(window.innerWidth - 150, rect.left + rect.width / 2)), y: above ? rect.top - 8 : rect.bottom + 8, above });
    void api<DictionaryEntry>(`/api/dictionary/${encodeURIComponent(word)}`, { signal: controller.signal }).then(setDictionary).catch((reason) => { if ((reason as Error).name !== 'AbortError') setDictionary({ word, ipa: '', type: '', meaning: '词典中暂无释义', note: '', example: '', audio: '', source: '' }); }).finally(() => setDictionaryLoading(false));
  };
  const toggleWord = async (word: string) => { await api('/api/vocabulary/toggle', { method: 'POST', ...jsonBody({ word, lessonId, cueId: manifest?.cues[activeRef.current]?.id }) }); await refresh(); };
  const translationLabel = manifest?.captionSource === 'official' ? '官方' : manifest?.lesson.translationStatus === 'ready' ? 'AI 已缓存' : manifest?.lesson.translationStatus === 'running' ? `AI 翻译 ${Math.round(manifest.lesson.translationProgress * 100)}%` : manifest?.lesson.translationStatus === 'failed' ? '翻译失败' : '待翻译';

  if (status === 'loading') return <main className="lesson-loading" aria-live="polite"><LoaderCircle className="spin" /><strong>正在切换课时</strong><span>旧字幕已经清除，正在加载本集媒体和字幕…</span></main>;
  if (status === 'error' || !manifest) return <main className="lesson-loading error-state"><AlertCircle /><strong>本课时暂时无法打开</strong><span>{error}</span><button onClick={() => void loadLesson(lessonId, true)}><RotateCcw size={15} />重新解析</button></main>;
  const cue = manifest.cues[activeIndex];
  return <>
    <div className="player-import"><input value={importUrl} onChange={(event) => setImportUrl(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void importLesson()} placeholder="粘贴公开的 DeepLearning.AI 课时网址" aria-label="课程网址" /><button onClick={() => void importLesson()} disabled={importing}>{importing ? <LoaderCircle className="spin" /> : <Import size={15} />}{importing ? '解析中' : '导入并加入当前课程'}</button></div>
    <main className="workspace">
      <section className="player-column">
        <div className="lesson-heading"><div><span className="eyebrow">{selectedCourse?.name || '未分类课程'} · 第 {lessonIndex + 1} 集</span><h1>{manifest.lesson.title}</h1></div><div className="lesson-side"><div className="course-actions"><select value={selectedCourse?.id || ''} onChange={(event) => changeCourse(event.target.value)} aria-label="选择课程">{data!.courses.map((course) => <option value={course.id} key={course.id}>{course.name} ({course.lessons.length})</option>)}</select><button className="save-course-button" onClick={async () => { if (!selectedCourse) return; await api(`/api/courses/${selectedCourse.id}/lessons`, { method: 'POST', ...jsonBody({ sourceUrl: manifest.lesson.sourceUrl, lessonId: manifest.lesson.id }) }); await refresh(); notify('已保存到课程，重复内容不会再次添加'); }}><Save size={14} />保存到课程</button></div><div className="episode-navigation"><button disabled={lessonIndex <= 0} onClick={() => goEpisode(-1)}><ChevronLeft size={15} />上一集</button><span>{lessonIndex >= 0 ? `${lessonIndex + 1} / ${selectedCourse.lessons.length}` : '未加入课程'}</span><button disabled={lessonIndex < 0 || lessonIndex >= selectedCourse.lessons.length - 1} onClick={() => goEpisode(1)}>下一集<ChevronRight size={15} /></button></div></div></div>
        <div className={`video-stage ${videoHidden ? 'video-hidden' : ''}`}>
          <video ref={videoRef} crossOrigin="anonymous" playsInline onClick={togglePlay} onTimeUpdate={onTimeUpdate} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onWaiting={() => setBuffering(true)} onPlaying={() => setBuffering(false)} />
          {videoHidden && <button className="audio-only" onClick={togglePlay}><EyeOff /><span>仅听音频</span><strong>{manifest.lesson.title}</strong></button>}
          {!videoHidden && !isPlaying && !buffering && <button className="big-play" onClick={togglePlay} aria-label="播放"><Play fill="currentColor" /></button>}
          {buffering && <div className="stage-status"><LoaderCircle className="spin" />缓冲中</div>}
          {phase !== 'idle' && <div className={`stage-status ${phase === 'pause' ? 'counting' : ''}`}>{phase === 'pause' ? <><span className="countdown-number">{countdown}</span>复述原句</> : ({ listening: '听原句', repeat: '核对原句', ready: '点击下一句' } as Record<string,string>)[phase]}</div>}
        </div>
        <div className="transport"><button className="play-button" onClick={togglePlay} aria-label={isPlaying ? '暂停' : '播放'}>{isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button><span className="timecode">{formatTime(currentTime)} / {formatTime(duration || manifest.lesson.duration || 0)}</span><input className="timeline" type="range" min="0" max={duration || manifest.lesson.duration || 0} step="0.1" value={currentTime} onChange={(event) => { const time = Number(event.target.value); if (videoRef.current) videoRef.current.currentTime = time; setCurrentTime(time); }} aria-label="播放进度" /><Volume2 className="volume-icon" size={16} /><input className="volume" type="range" min="0" max="1" step=".05" value={volume} onChange={(event) => { const value = Number(event.target.value); setVolume(value); if (videoRef.current) videoRef.current.volume = value; }} aria-label="音量" /><button className="speed-button" onClick={() => { const values = [.75, 1, 1.25, 1.5, 2]; const next = values[(values.indexOf(speed) + 1) % values.length]; setSpeed(next); if (videoRef.current) videoRef.current.playbackRate = next; }}>{speed}×</button><button className="icon-button" onClick={() => void updateSettings({ videoHidden: !videoHidden })} aria-label={videoHidden ? '显示视频' : '隐藏视频'}>{videoHidden ? <Eye /> : <EyeOff />}</button><button className="icon-button" onClick={() => videoRef.current?.requestFullscreen()} aria-label="全屏"><Maximize /></button></div>
        <div className="study-bar"><div className="mode-toggle"><label><input type="checkbox" checked={studyMode} onChange={(event) => { setStudyMode(event.target.checked); setPhase('idle'); }} /><span /></label><strong>学习模式</strong><small>听一句 · 复述 · 再听</small></div><div className="wait-setting"><span>复述时间</span><button onClick={() => void updateSettings({ waitSeconds: Math.max(1, waitSeconds - 1) })}>−</button><strong>{waitSeconds}s</strong><button onClick={() => void updateSettings({ waitSeconds: Math.min(15, waitSeconds + 1) })}>+</button></div><div className="study-actions"><button className="secondary-button" disabled={activeIndex <= 0} onClick={() => playCue(activeIndex - 1)}><RotateCcw size={14} />上一句</button><button className="next-button" disabled={activeIndex >= manifest.cues.length - 1} onClick={() => playCue(activeIndex + 1)}><SkipForward size={14} />下一句</button></div></div>
        <div className="current-sentence"><div className="sentence-kicker"><Languages size={14} />当前句 · {activeIndex + 1}/{manifest.cues.length} · {translationLabel}</div><div className="sentence-grid"><div className="sentence-en"><p>{cue?.en || '本集没有可用的英文字幕'}</p></div><div className="sentence-zh"><p>{cue?.zh || '本句中文翻译尚未生成'}</p></div></div>{manifest.lesson.translationStatus === 'failed' && <button className="translation-retry" onClick={async () => { await api(`/api/lessons/${lessonId}/translations`, { method: 'POST' }); setManifest(await api(`/api/lessons/${lessonId}`)); }}>重新翻译</button>}</div>
      </section>
      <TranscriptPanel cues={manifest.cues} activeIndex={activeIndex} query={query} setQuery={setQuery} onCue={(index) => playCue(index)} vocabulary={data!.vocabulary} tab={tab} setTab={setTab} dictionary={dictionary} dictionaryLoading={dictionaryLoading} inspectedWord={inspectedWord} tooltip={tooltip} onWordHover={inspectWord} onWordLeave={() => setTooltip(null)} onWordToggle={(word) => void toggleWord(word)} onReview={() => navigate('/review/0')} translationLabel={translationLabel} />
    </main>
  </>;
}

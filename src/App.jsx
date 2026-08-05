import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  BarChart3,
  BrainCircuit,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Import,
  Eye,
  EyeOff,
  FolderPlus,
  Languages,
  Library,
  ListMusic,
  Maximize,
  Pause,
  Play,
  RotateCcw,
  Search,
  Shuffle,
  Sparkles,
  Timer,
  Volume2,
  X,
} from 'lucide-react';

const COURSE_URL = 'https://learn.deeplearning.ai/courses/ai-prompting-for-everyone/lesson/de11nq6r/the-ai-novice-and-the-ai-power-user';
const VIDEO_URL = 'https://video.deeplearning.ai/upv2/ai-prompting-for-everyone/lc-ai-prompting-for-everyone-C1-W1-L1-novice-vs-power-user/1784273478-0f49e1a8239d-master.m3u8?v=1784280991';
const LESSON_TITLE = 'The AI novice and the AI power user';
const LEARNED_THRESHOLD_SECONDS = 30;

const DEFAULT_COURSES = [
  { id: 'ai-prompting', name: 'AI Prompting for Everyone', createdAt: Date.now(), items: [] },
];

const WORDS = {
  impactful: {
    ipa: '/ɪmˈpæktfəl/',
    type: 'adj.',
    meaning: '有重大影响的；能产生明显效果的',
    note: '常修饰 skill、decision、change。比 important 更强调实际产生的影响。',
    example: 'Using AI well is one of the most impactful skills you can develop.',
  },
  novice: {
    ipa: '/ˈnɑːvɪs/',
    type: 'n.',
    meaning: '新手；初学者',
    note: '强调刚进入某个领域、经验尚少的人。反义表达是 expert 或 power user。',
    example: 'An AI novice may use a short prompt and hope for the best.',
  },
  contrast: {
    ipa: '/ˈkɑːntræst/',
    type: 'n. / v.',
    meaning: '对比；形成鲜明对照',
    note: 'In contrast 是口语和写作中很实用的转折连接语。',
    example: 'In contrast, power users give the model enough context.',
  },
  prompting: {
    ipa: '/ˈprɑːmptɪŋ/',
    type: 'n.',
    meaning: '向 AI 提供指令或提示的过程',
    note: '在 AI 语境中，prompt 既可作名词“提示词”，也可作动词“给出提示”。',
    example: 'Prompting AI models has changed quickly.',
  },
  cutting: {
    ipa: '/ˈkʌtɪŋ/',
    type: 'phrase',
    meaning: 'cutting edge：前沿；尖端水平',
    note: '通常以 on/at the cutting edge of 的形式出现。',
    example: 'They work at the cutting edge of AI research.',
  },
  frustrating: {
    ipa: '/ˈfrʌstreɪtɪŋ/',
    type: 'adj.',
    meaning: '令人沮丧的；令人懊恼的',
    note: '描述事物让人受挫；frustrated 描述人的感受。',
    example: 'The model sometimes generates frustrating outputs.',
  },
  advantage: {
    ipa: '/ədˈvæntɪdʒ/',
    type: 'n.',
    meaning: '优势；有利条件',
    note: 'take advantage of 表示“充分利用”，不一定含有占便宜的负面含义。',
    example: "Take advantage of today's AI tools.",
  },
  context: {
    ipa: '/ˈkɑːntekst/',
    type: 'n.',
    meaning: '语境；背景信息',
    note: '在 AI 使用中，context 指模型完成任务所需的材料、限制和背景。',
    example: 'Provide the right context before asking the question.',
  },
};

function parseTime(value) {
  const parts = value.split(':').map(Number);
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function parseVtt(source, translations) {
  return source
    .replace(/\r/g, '')
    .split(/\n\n+/)
    .filter((block) => block.includes('-->'))
    .map((block, index) => {
      const lines = block.split('\n');
      const timingIndex = lines.findIndex((line) => line.includes('-->'));
      const [start, end] = lines[timingIndex].split('-->').map((item) => item.trim());
      return {
        id: index + 1,
        start: parseTime(start),
        end: parseTime(end.split(' ')[0]),
        en: lines.slice(timingIndex + 1).join(' ').replace(/<[^>]+>/g, '').trim(),
        zh: translations[index] || '正在生成中文翻译…',
      };
    });
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function normalizeWord(word) {
  return word.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '');
}

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.search = '';
    parsed.hash = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return value.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
}

function formatStudyTime(seconds) {
  if (seconds < 60) return `${Math.floor(seconds)} 秒`;
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes} 分钟`;
  return `${hours} 小时 ${minutes} 分钟`;
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function WordText({ text, onInspect, onHover, onLeave, savedWords }) {
  return text.split(/(\b[A-Za-z]+(?:['’-][A-Za-z]+)?\b)/).map((part, index) => {
    if (!/[A-Za-z]/.test(part)) return <span key={index}>{part}</span>;
    const word = normalizeWord(part);
    return (
      <button
        className={`word ${savedWords.includes(word) ? 'saved' : ''}`}
        key={`${part}-${index}`}
        onMouseEnter={(event) => {
          onInspect(part);
          onHover(part, event.currentTarget);
        }}
        onMouseLeave={onLeave}
        onFocus={(event) => {
          onInspect(part);
          onHover(part, event.currentTarget);
        }}
        onBlur={onLeave}
        onClick={(event) => {
          event.stopPropagation();
          onInspect(part, true);
        }}
      >
        {part}
      </button>
    );
  });
}

export default function App() {
  const videoRef = useRef(null);
  const transcriptRef = useRef(null);
  const phaseRef = useRef('idle');
  const activeRef = useRef(0);
  const studyModeRef = useRef(true);
  const handledEndRef = useRef(false);

  const [cues, setCues] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(579);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [speed, setSpeed] = useState(1);
  const [studyMode, setStudyMode] = useState(true);
  const [waitSeconds, setWaitSeconds] = useState(3);
  const [countdown, setCountdown] = useState(0);
  const [phase, setPhase] = useState('idle');
  const [selectedWord, setSelectedWord] = useState('impactful');
  const [savedWords, setSavedWords] = useState(() => readStorage('echoline-vocabulary', ['novice']));
  const [dictionaryCache, setDictionaryCache] = useState(() => readStorage('echoline-dictionary-cache', {}));
  const [dictionaryStatus, setDictionaryStatus] = useState('idle');
  const [wordTooltip, setWordTooltip] = useState(null);
  const [url, setUrl] = useState(COURSE_URL);
  const [currentLessonUrl, setCurrentLessonUrl] = useState(COURSE_URL);
  const [importState, setImportState] = useState('ready');
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState('transcript');
  const [query, setQuery] = useState('');
  const [videoHidden, setVideoHidden] = useState(false);
  const [reviewGroup, setReviewGroup] = useState(0);
  const [reviewDeck, setReviewDeck] = useState([]);
  const [reviewPosition, setReviewPosition] = useState(0);
  const [reviewRevealed, setReviewRevealed] = useState(false);
  const [courses, setCourses] = useState(() => readStorage('echoline-courses', DEFAULT_COURSES));
  const [selectedCourseId, setSelectedCourseId] = useState(() => readStorage('echoline-selected-course', 'ai-prompting'));
  const [creatingCourse, setCreatingCourse] = useState(false);
  const [newCourseName, setNewCourseName] = useState('');
  const [stats, setStats] = useState(() => readStorage('echoline-study-stats', { totalSeconds: 0, videos: {} }));
  const [statsOpen, setStatsOpen] = useState(false);
  const [appView, setAppView] = useState('player');

  const setLearningPhase = useCallback((value) => {
    phaseRef.current = value;
    setPhase(value);
  }, []);

  useEffect(() => {
    activeRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    studyModeRef.current = studyMode;
    if (!studyMode) setLearningPhase('idle');
  }, [studyMode, setLearningPhase]);

  useEffect(() => {
    Promise.all([
      fetch('/demo-en.vtt').then((response) => response.text()),
      fetch('/demo-zh.json').then((response) => response.json()),
    ]).then(([vtt, translations]) => setCues(parseVtt(vtt, translations)));
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    let hls;
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = VIDEO_URL;
    } else if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true });
      hls.loadSource(VIDEO_URL);
      hls.attachMedia(video);
    }
    return () => hls?.destroy();
  }, []);

  useEffect(() => {
    localStorage.setItem('echoline-vocabulary', JSON.stringify(savedWords));
  }, [savedWords]);

  useEffect(() => {
    localStorage.setItem('echoline-dictionary-cache', JSON.stringify(dictionaryCache));
  }, [dictionaryCache]);

  useEffect(() => {
    localStorage.setItem('echoline-courses', JSON.stringify(courses));
  }, [courses]);

  useEffect(() => {
    localStorage.setItem('echoline-selected-course', JSON.stringify(selectedCourseId));
  }, [selectedCourseId]);

  useEffect(() => {
    localStorage.setItem('echoline-study-stats', JSON.stringify(stats));
  }, [stats]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    const canonicalUrl = normalizeUrl(currentLessonUrl);
    const timer = window.setInterval(() => {
      setStats((current) => {
        const videoStats = current.videos[canonicalUrl] || {
          title: LESSON_TITLE,
          url: currentLessonUrl,
          studiedSeconds: 0,
          learned: false,
        };
        const studiedSeconds = videoStats.studiedSeconds + 1;
        return {
          totalSeconds: current.totalSeconds + 1,
          videos: {
            ...current.videos,
            [canonicalUrl]: {
              ...videoStats,
              studiedSeconds,
              learned: studiedSeconds >= LEARNED_THRESHOLD_SECONDS,
              lastStudiedAt: Date.now(),
            },
          },
        };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isPlaying, currentLessonUrl]);

  useEffect(() => {
    if (!selectedWord) return undefined;
    if (dictionaryCache[selectedWord]) {
      setDictionaryStatus('ready');
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setDictionaryStatus('loading');
      try {
        const [dictionaryResult, translationResult] = await Promise.allSettled([
          fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(selectedWord)}`, { signal: controller.signal })
            .then((response) => response.ok ? response.json() : Promise.reject(new Error('dictionary'))),
          fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(selectedWord)}&langpair=en|zh-CN`, { signal: controller.signal })
            .then((response) => response.ok ? response.json() : Promise.reject(new Error('translation'))),
        ]);

        const entry = dictionaryResult.status === 'fulfilled' ? dictionaryResult.value?.[0] : null;
        const meaning = entry?.meanings?.[0];
        const definition = meaning?.definitions?.[0];
        const fallback = WORDS[selectedWord];
        const translated = translationResult.status === 'fulfilled'
          ? translationResult.value?.responseData?.translatedText
          : '';
        const looksUntranslated = !translated || translated.toLowerCase() === selectedWord.toLowerCase();

        if (!entry && !fallback && looksUntranslated) throw new Error('not-found');

        const info = {
          ipa: entry?.phonetic || entry?.phonetics?.find((item) => item.text)?.text || fallback?.ipa || '',
          type: meaning?.partOfSpeech || fallback?.type || 'word',
          meaning: !looksUntranslated ? translated : (fallback?.meaning || definition?.definition || '暂无中文释义'),
          note: definition?.definition || fallback?.note || '词典暂未提供详细用法。',
          example: definition?.example || fallback?.example || cues[activeRef.current]?.en || '',
          audio: entry?.phonetics?.find((item) => item.audio)?.audio || '',
          source: entry ? 'Free Dictionary' : '离线词典',
        };
        setDictionaryCache((current) => ({ ...current, [selectedWord]: info }));
        setDictionaryStatus('ready');
      } catch (error) {
        if (error.name !== 'AbortError') setDictionaryStatus('error');
      }
    }, 320);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [selectedWord, dictionaryCache, cues]);

  const playCue = useCallback((index, nextPhase = 'listening') => {
    const video = videoRef.current;
    const cue = cues[index];
    if (!video || !cue) return;
    handledEndRef.current = false;
    activeRef.current = index;
    setActiveIndex(index);
    setLearningPhase(nextPhase);
    video.currentTime = cue.start + 0.02;
    video.play().catch(() => {});
  }, [cues, setLearningPhase]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !cues.length) return undefined;

    const onTime = () => {
      const time = video.currentTime;
      setCurrentTime(time);
      const current = activeRef.current;
      const cue = cues[current];

      if (studyModeRef.current && cue && (phaseRef.current === 'listening' || phaseRef.current === 'repeat')) {
        if (time >= cue.end - 0.04 && !handledEndRef.current) {
          handledEndRef.current = true;
          video.pause();
          if (phaseRef.current === 'repeat') {
            setLearningPhase('ready');
          } else {
            setLearningPhase('pause');
            setCountdown(waitSeconds);
          }
        }
        return;
      }

      if (!studyModeRef.current) {
        const found = cues.findIndex((item) => time >= item.start && time < item.end);
        if (found >= 0 && found !== activeRef.current) {
          activeRef.current = found;
          setActiveIndex(found);
        }
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onMeta = () => setDuration(video.duration || 579);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('loadedmetadata', onMeta);
    return () => {
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('loadedmetadata', onMeta);
    };
  }, [cues, waitSeconds, setLearningPhase]);

  useEffect(() => {
    if (phase !== 'pause') return undefined;
    if (countdown <= 0) {
      playCue(activeRef.current, 'repeat');
      return undefined;
    }
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [phase, countdown, playCue]);

  useEffect(() => {
    const row = transcriptRef.current?.querySelector(`[data-cue="${activeIndex}"]`);
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIndex]);

  const inspectWord = useCallback((rawWord, save = false) => {
    const word = normalizeWord(rawWord);
    setSelectedWord(word);
    if (save) {
      setSavedWords((items) => items.includes(word) ? items : [...items, word]);
      setNotice(`“${word}” 已加入生词本`);
      window.setTimeout(() => setNotice(''), 1800);
    }
  }, []);

  const showWordTooltip = useCallback((rawWord, element) => {
    const word = normalizeWord(rawWord);
    const rect = element.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 145, Math.max(145, rect.left + rect.width / 2));
    const above = rect.bottom > window.innerHeight - 130;
    setWordTooltip({
      word,
      x,
      y: above ? rect.top - 8 : rect.bottom + 8,
      above,
    });
  }, []);

  const wordInfo = dictionaryCache[selectedWord] || WORDS[selectedWord] || {
    ipa: '',
    type: 'word',
    meaning: dictionaryStatus === 'loading' ? '正在查询免费词典…' : `暂未找到“${selectedWord}”的中文释义。`,
    note: dictionaryStatus === 'error' ? '词典服务暂时不可用，请稍后将鼠标移回该词重试。' : '释义来自免费词典服务，并会缓存在当前浏览器。',
    example: cues[activeIndex]?.en || '',
  };

  const tooltipInfo = wordTooltip ? (dictionaryCache[wordTooltip.word] || WORDS[wordTooltip.word]) : null;
  const tooltipError = wordTooltip?.word === selectedWord && dictionaryStatus === 'error';

  const handleImport = () => {
    if (!url.trim()) return;
    setImportState('loading');
    window.setTimeout(() => {
      if (url.includes('learn.deeplearning.ai') && url.includes('de11nq6r')) {
        setImportState('done');
        setCurrentLessonUrl(url);
        setNotice('课程、音轨与 89 句双语字幕已载入');
        playCue(0, 'listening');
      } else {
        setImportState('error');
        setNotice('此原型已完整适配示例课程；其他登录课程需安装页面采集器');
      }
      window.setTimeout(() => setNotice(''), 3000);
    }, 650);
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (studyMode && (phase === 'idle' || phase === 'ready')) playCue(activeIndex, 'listening');
      else video.play().catch(() => {});
    } else video.pause();
  };

  const goToCue = (index) => {
    if (studyMode) playCue(index, 'listening');
    else {
      videoRef.current.currentTime = cues[index].start;
      setActiveIndex(index);
    }
  };

  const filteredCues = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return cues.map((cue, index) => ({ cue, index }));
    return cues.map((cue, index) => ({ cue, index })).filter(({ cue }) => `${cue.en} ${cue.zh}`.toLowerCase().includes(term));
  }, [cues, query]);

  const vocabularyGroups = useMemo(() => {
    const groups = [];
    for (let index = 0; index < savedWords.length; index += 10) {
      groups.push(savedWords.slice(index, index + 10));
    }
    return groups;
  }, [savedWords]);

  const startReview = useCallback((groupIndex) => {
    const group = vocabularyGroups[groupIndex] || [];
    setReviewGroup(groupIndex);
    setReviewDeck(shuffle(group));
    setReviewPosition(0);
    setReviewRevealed(false);
    setPanel('review');
  }, [vocabularyGroups]);

  const currentReviewWord = reviewDeck[reviewPosition] || '';
  const currentReviewInfo = dictionaryCache[currentReviewWord] || WORDS[currentReviewWord] || {
    ipa: '',
    type: 'word',
    meaning: '返回字幕，将鼠标移到这个词上即可查询词典。',
    note: '词典结果查询后会自动保存到本机。',
    example: '',
  };

  const createCourse = () => {
    const name = newCourseName.trim();
    if (!name) return;
    const course = {
      id: `course-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      createdAt: Date.now(),
      items: [],
    };
    setCourses((items) => [...items, course]);
    setSelectedCourseId(course.id);
    setNewCourseName('');
    setCreatingCourse(false);
    setNotice(`课程“${name}”已创建`);
    window.setTimeout(() => setNotice(''), 1800);
  };

  const saveLessonToCourse = () => {
    const canonicalUrl = normalizeUrl(currentLessonUrl);
    if (!selectedCourseId) {
      setCreatingCourse(true);
      return;
    }
    let duplicated = false;
    setCourses((items) => items.map((course) => {
      if (course.id !== selectedCourseId) return course;
      if (course.items.some((item) => item.canonicalUrl === canonicalUrl)) {
        duplicated = true;
        return course;
      }
      return {
        ...course,
        items: [...course.items, {
          title: LESSON_TITLE,
          url: currentLessonUrl,
          canonicalUrl,
          addedAt: Date.now(),
        }],
      };
    }));
    setNotice(duplicated ? '该视频已在当前课程中，无需重复保存' : '当前视频已保存到课程');
    window.setTimeout(() => setNotice(''), 2200);
  };

  const openCourseManager = () => {
    videoRef.current?.pause();
    setWordTooltip(null);
    setCreatingCourse(false);
    setAppView('courses');
  };

  const openCourseItem = (courseId, item) => {
    setSelectedCourseId(courseId);
    setUrl(item.url);
    setCurrentLessonUrl(item.url);
    setCreatingCourse(false);
    setAppView('player');
    setNotice(`已打开“${item.title}”`);
    window.setTimeout(() => setNotice(''), 1800);
  };

  const learnedVideos = Object.values(stats.videos).filter((item) => item.learned);
  const learnedCourses = courses.filter((course) => course.items.some((item) => stats.videos[item.canonicalUrl]?.learned));
  const managedCourse = courses.find((course) => course.id === selectedCourseId) || courses[0];
  const savedLessonCount = courses.reduce((total, course) => total + course.items.length, 0);
  const phaseLabel = {
    idle: '准备开始',
    listening: '听原句',
    pause: `复述时间 ${countdown}s`,
    repeat: '核对原句',
    ready: '等待下一句',
  }[phase];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><span /><span /><span /><span /></div>
          <div><strong>EchoLine</strong><small>AI English Studio</small></div>
        </div>
        {appView === 'player' ? (
          <div className="course-import">
            <span className="source-label">课程来源</span>
            <input aria-label="课程网址" value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && handleImport()} />
            <button className="primary-button" onClick={handleImport} disabled={importState === 'loading'}>
              {importState === 'loading' ? <span className="loader" /> : <Import size={16} />}
              {importState === 'loading' ? '解析中' : '导入'}
            </button>
          </div>
        ) : (
          <div className="topbar-context"><Library size={17} /><span><strong>课程管理</strong><small>整理课程与学习内容</small></span></div>
        )}
        <div className="top-actions">
          <button className="stats-button" onClick={() => setStatsOpen(true)} title="学习统计">
            <BarChart3 size={16} /><span>{formatStudyTime(stats.totalSeconds)}</span>
          </button>
          <button className="manage-course-button" onClick={appView === 'player' ? openCourseManager : () => { setCreatingCourse(false); setAppView('player'); }}>
            {appView === 'player' ? <Library size={16} /> : <ArrowLeft size={16} />}
            {appView === 'player' ? '课程管理' : '返回播放器'}
          </button>
        </div>
      </header>

      {appView === 'courses' ? (
        <main className="course-manager-page">
          <section className="manager-heading">
            <div><span className="eyebrow">Course Library</span><h1>课程管理</h1><p>管理课程分组和已经保存的学习视频。</p></div>
            <button className="manager-create-button" onClick={() => setCreatingCourse(true)}><FolderPlus size={16} />新建课程</button>
          </section>

          {creatingCourse && (
            <div className="manager-create-row">
              <FolderPlus size={17} />
              <input autoFocus value={newCourseName} onChange={(event) => setNewCourseName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && createCourse()} placeholder="输入新课程名称" aria-label="新课程名称" />
              <button className="next-button" onClick={createCourse}><Check size={15} />创建</button>
              <button className="icon-button" onClick={() => setCreatingCourse(false)} aria-label="取消"><X size={16} /></button>
            </div>
          )}

          <section className="manager-summary" aria-label="课程概览">
            <div><Library size={18} /><span><strong>{courses.length}</strong><small>课程集</small></span></div>
            <div><ListMusic size={18} /><span><strong>{savedLessonCount}</strong><small>已保存视频</small></span></div>
            <div><Check size={18} /><span><strong>{learnedVideos.length}</strong><small>已学视频</small></span></div>
            <div><Timer size={18} /><span><strong>{formatStudyTime(stats.totalSeconds)}</strong><small>累计学习</small></span></div>
          </section>

          <div className="course-library-layout">
            <nav className="course-navigation" aria-label="课程列表">
              <div className="course-navigation-head"><strong>全部课程</strong><span>{courses.length}</span></div>
              {courses.map((course) => {
                const learnedCount = course.items.filter((item) => stats.videos[item.canonicalUrl]?.learned).length;
                return (
                  <button className={course.id === managedCourse?.id ? 'active' : ''} key={course.id} onClick={() => setSelectedCourseId(course.id)}>
                    <span className="course-nav-icon"><Library size={16} /></span>
                    <span><strong>{course.name}</strong><small>{course.items.length} 个视频 · {learnedCount} 个已学</small></span>
                    <ChevronRight size={15} />
                  </button>
                );
              })}
            </nav>

            <section className="course-detail">
              {managedCourse ? (
                <>
                  <div className="course-detail-head">
                    <div><span>当前课程</span><h2>{managedCourse.name}</h2><p>创建于 {new Date(managedCourse.createdAt).toLocaleDateString('zh-CN')}</p></div>
                    <strong>{managedCourse.items.length} 个视频</strong>
                  </div>
                  <div className="course-item-head"><span>学习内容</span><span>学习进度</span><span>操作</span></div>
                  <div className="course-item-list">
                    {managedCourse.items.map((item, index) => {
                      const itemStats = stats.videos[item.canonicalUrl];
                      return (
                        <article className="course-item" key={item.canonicalUrl}>
                          <span className="course-item-index">{String(index + 1).padStart(2, '0')}</span>
                          <div className="course-item-title"><strong>{item.title}</strong><small>{new URL(item.url).hostname} · 添加于 {new Date(item.addedAt).toLocaleDateString('zh-CN')}</small></div>
                          <div className="course-item-progress"><span className={itemStats?.learned ? 'learned' : ''}>{itemStats?.learned ? '已学习' : '未开始'}</span><small>{formatStudyTime(itemStats?.studiedSeconds || 0)}</small></div>
                          <button className="open-course-item" onClick={() => openCourseItem(managedCourse.id, item)}><Play size={14} fill="currentColor" />进入学习</button>
                        </article>
                      );
                    })}
                    {!managedCourse.items.length && (
                      <div className="empty-course"><ListMusic size={30} /><strong>这个课程还没有视频</strong><span>回到播放器，将当前视频保存到“{managedCourse.name}”。</span><button className="next-button" onClick={() => { setCreatingCourse(false); setAppView('player'); }}><ArrowLeft size={15} />返回播放器</button></div>
                    )}
                  </div>
                </>
              ) : (
                <div className="empty-course"><Library size={30} /><strong>还没有课程</strong><button className="next-button" onClick={() => setCreatingCourse(true)}><FolderPlus size={15} />新建课程</button></div>
              )}
            </section>
          </div>
        </main>
      ) : (
      <main className="workspace">
        <section className="player-column">
          <div className="lesson-heading">
            <div>
              <span className="eyebrow">AI Prompting for Everyone · Lesson 1</span>
              <h1>{LESSON_TITLE}</h1>
            </div>
            <div className="lesson-side">
              <div className="lesson-meta"><Clock3 size={15} /> 09:39 <span>•</span> 89 句</div>
              <div className="course-actions">
                <select aria-label="选择课程" value={selectedCourseId} onChange={(event) => setSelectedCourseId(event.target.value)}>
                  {courses.map((course) => <option key={course.id} value={course.id}>{course.name} ({course.items.length})</option>)}
                </select>
                <button className="icon-button compact" onClick={() => setCreatingCourse((value) => !value)} title="新建课程" aria-label="新建课程"><FolderPlus size={16} /></button>
                <button className="save-course-button" onClick={saveLessonToCourse}><Bookmark size={14} />保存到课程</button>
              </div>
              {creatingCourse && (
                <div className="course-create">
                  <input autoFocus value={newCourseName} onChange={(event) => setNewCourseName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && createCourse()} placeholder="输入课程名称" aria-label="课程名称" />
                  <button onClick={createCourse} aria-label="确认创建"><Check size={15} /></button>
                  <button onClick={() => setCreatingCourse(false)} aria-label="取消"><X size={15} /></button>
                </div>
              )}
            </div>
          </div>

          <div className={`video-stage ${videoHidden ? 'video-hidden' : ''}`}>
            <video ref={videoRef} crossOrigin="anonymous" playsInline onClick={togglePlay} />
            {videoHidden && (
              <button className="audio-only" onClick={togglePlay} aria-label={isPlaying ? '暂停音频' : '播放音频'}>
                <div className={`audio-bars ${isPlaying ? 'moving' : ''}`}><i /><i /><i /><i /><i /><i /><i /></div>
                <EyeOff size={19} />
                <span>仅听音频</span>
                <strong>{LESSON_TITLE}</strong>
              </button>
            )}
            <div className={`stage-status ${phase === 'pause' ? 'counting' : ''}`}>
              {phase === 'pause' ? <span className="countdown-number">{countdown}</span> : <BrainCircuit size={16} />}
              <span>{phaseLabel}</span>
            </div>
            {!isPlaying && phase === 'idle' && (
              <button className="big-play" onClick={() => playCue(activeIndex, 'listening')} aria-label="播放"><Play fill="currentColor" size={26} /></button>
            )}
          </div>

          <div className="transport">
            <button className="icon-button" onClick={() => goToCue(Math.max(0, activeIndex - 1))} title="上一句" aria-label="上一句"><ChevronLeft size={22} /></button>
            <button className="play-button" onClick={togglePlay} title={isPlaying ? '暂停' : '播放'} aria-label={isPlaying ? '暂停' : '播放'}>{isPlaying ? <Pause fill="currentColor" size={19} /> : <Play fill="currentColor" size={19} />}</button>
            <button className="icon-button" onClick={() => goToCue(Math.min(cues.length - 1, activeIndex + 1))} title="下一句" aria-label="下一句"><ChevronRight size={22} /></button>
            <span className="timecode">{formatTime(currentTime)} <i>/</i> {formatTime(duration)}</span>
            <input className="timeline" aria-label="播放进度" type="range" min="0" max={duration || 579} step="0.1" value={Math.min(currentTime, duration || 579)} onChange={(event) => { videoRef.current.currentTime = Number(event.target.value); }} />
            <Volume2 size={17} className="volume-icon" />
            <input className="volume" aria-label="音量" type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => { const next = Number(event.target.value); setVolume(next); videoRef.current.volume = next; }} />
            <button className="speed-button" onClick={() => { const options = [0.75, 1, 1.25, 1.5]; const next = options[(options.indexOf(speed) + 1) % options.length]; setSpeed(next); videoRef.current.playbackRate = next; }} title="播放速度">{speed}×</button>
            <button className="icon-button" onClick={() => setVideoHidden((value) => !value)} title={videoHidden ? '显示视频' : '隐藏视频，仅听音频'} aria-label={videoHidden ? '显示视频' : '隐藏视频，仅听音频'}>{videoHidden ? <Eye size={17} /> : <EyeOff size={17} />}</button>
            <button className="icon-button" onClick={() => videoRef.current.requestFullscreen?.()} title="全屏" aria-label="全屏"><Maximize size={17} /></button>
          </div>

          <div className="study-bar">
            <label className="mode-toggle">
              <input type="checkbox" checked={studyMode} onChange={(event) => setStudyMode(event.target.checked)} />
              <span className="toggle-track"><span /></span>
              <span><strong>学习模式</strong><small>听一句 · 复述 · 再听一遍</small></span>
            </label>
            <div className="wait-setting"><span>复述停顿</span><button onClick={() => setWaitSeconds(Math.max(1, waitSeconds - 1))}>−</button><b>{waitSeconds} 秒</b><button onClick={() => setWaitSeconds(Math.min(10, waitSeconds + 1))}>+</button></div>
            <div className="study-actions">
              <button className="secondary-button" onClick={() => playCue(activeIndex, 'listening')}><RotateCcw size={16} /> 再听一次</button>
              <button className="next-button" onClick={() => goToCue(Math.min(cues.length - 1, activeIndex + 1))}>下一句 <ChevronRight size={17} /></button>
            </div>
          </div>

          <div className="current-sentence">
            <div className="sentence-kicker"><span>第 {activeIndex + 1} / {cues.length || 89} 句</span><span>{formatTime(cues[activeIndex]?.start || 0)} — {formatTime(cues[activeIndex]?.end || 0)}</span></div>
            <div className="sentence-grid">
              <div className="sentence-en"><span className="language-tag">EN</span><p><WordText text={cues[activeIndex]?.en || 'Loading transcript…'} onInspect={inspectWord} onHover={showWordTooltip} onLeave={() => setWordTooltip(null)} savedWords={savedWords} /></p></div>
              <div className="sentence-zh"><span className="language-tag">中</span><p>{cues[activeIndex]?.zh || '正在载入双语字幕…'}</p></div>
            </div>
          </div>
        </section>

        <aside className="learning-panel">
          <div className="panel-tabs">
            <button className={panel === 'transcript' ? 'active' : ''} onClick={() => setPanel('transcript')}><ListMusic size={16} />逐句字幕</button>
            <button className={panel === 'vocabulary' ? 'active' : ''} onClick={() => setPanel('vocabulary')}><Bookmark size={16} />生词本 <span>{savedWords.length}</span></button>
            <button className={panel === 'review' ? 'active' : ''} onClick={() => startReview(Math.min(reviewGroup, Math.max(0, vocabularyGroups.length - 1)))}><Shuffle size={16} />复习</button>
          </div>

          {panel === 'transcript' ? (
            <>
              <div className="panel-tools">
                <div className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索字幕" aria-label="搜索字幕" />{query && <button onClick={() => setQuery('')} aria-label="清空搜索"><X size={14} /></button>}</div>
                <div className="language-pair"><Languages size={15} /> EN <span>→</span> 中文</div>
              </div>
              <div className="transcript-head"><span>时间</span><span>English</span><span>中文</span></div>
              <div className="transcript-list" ref={transcriptRef} onScroll={() => setWordTooltip(null)}>
                {filteredCues.map(({ cue, index }) => (
                  <div
                    className={`cue-row ${index === activeIndex ? 'active' : ''}`}
                    key={cue.id}
                    data-cue={index}
                    role="button"
                    tabIndex="0"
                    onClick={() => goToCue(index)}
                    onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && goToCue(index)}
                  >
                    <span className="cue-time">{formatTime(cue.start)}</span>
                    <span className="cue-en"><WordText text={cue.en} onInspect={inspectWord} onHover={showWordTooltip} onLeave={() => setWordTooltip(null)} savedWords={savedWords} /></span>
                    <span className="cue-zh">{cue.zh}</span>
                    {index === activeIndex && <span className="playing-bars"><i /><i /><i /></span>}
                  </div>
                ))}
              </div>
            </>
          ) : panel === 'vocabulary' ? (
            <div className="vocabulary-list">
              <div className="vocab-summary"><strong>{savedWords.length}</strong><span>个生词 · {vocabularyGroups.length} 组</span><button onClick={() => startReview(0)} disabled={!savedWords.length}><Shuffle size={15} /> 开始复习</button></div>
              {savedWords.map((word) => {
                const info = dictionaryCache[word] || WORDS[word];
                return <button className="vocab-item" key={word} onClick={() => setSelectedWord(word)}><span><strong>{word}</strong><small>{info?.ipa || '已收藏'}</small></span><p>{info?.meaning || '打开字幕并悬停查词'}</p><Check size={15} /></button>;
              })}
            </div>
          ) : (
            <div className="review-panel">
              <div className="review-toolbar">
                <div className="group-list" aria-label="复习分组">
                  {vocabularyGroups.map((group, index) => (
                    <button className={reviewGroup === index ? 'active' : ''} key={index} onClick={() => startReview(index)}>
                      第 {index + 1} 组 <small>{group.length}</small>
                    </button>
                  ))}
                </div>
                {reviewDeck.length > 0 && <button className="reshuffle" onClick={() => startReview(reviewGroup)} title="重新随机排序"><Shuffle size={15} /></button>}
              </div>
              {reviewDeck.length ? (
                <div className="review-session">
                  <div className="review-progress"><span>第 {reviewGroup + 1} 组</span><span>{reviewPosition + 1} / {reviewDeck.length}</span></div>
                  <button className={`flashcard ${reviewRevealed ? 'revealed' : ''}`} onClick={() => setReviewRevealed(true)}>
                    <span className="flashcard-label">{reviewRevealed ? '释义' : '单词'}</span>
                    <strong>{currentReviewWord}</strong>
                    <small>{currentReviewInfo.ipa} {currentReviewInfo.type && `· ${currentReviewInfo.type}`}</small>
                    {reviewRevealed ? (
                      <div className="flashcard-answer"><p>{currentReviewInfo.meaning}</p><blockquote>{currentReviewInfo.note}</blockquote>{currentReviewInfo.example && <em>{currentReviewInfo.example}</em>}</div>
                    ) : <span className="reveal-hint">点击卡片查看释义</span>}
                  </button>
                  <div className="review-actions">
                    <button className="secondary-button" disabled={reviewPosition === 0} onClick={() => { setReviewPosition((value) => value - 1); setReviewRevealed(false); }}><ChevronLeft size={16} />上一词</button>
                    <button className="next-button" onClick={() => {
                      if (reviewPosition === reviewDeck.length - 1) startReview(reviewGroup);
                      else { setReviewPosition((value) => value + 1); setReviewRevealed(false); }
                    }}>{reviewPosition === reviewDeck.length - 1 ? <><Shuffle size={15} />再来一轮</> : <>下一词<ChevronRight size={16} /></>}</button>
                  </div>
                </div>
              ) : (
                <div className="empty-review"><Library size={30} /><strong>生词本还是空的</strong><span>在字幕中点击单词，凑齐后即可按每 10 个一组复习。</span></div>
              )}
            </div>
          )}

          {panel !== 'review' && <div className="word-inspector">
            <div className="word-title">
              <div><span>{selectedWord}</span><small>{dictionaryStatus === 'loading' ? '查询中…' : `${wordInfo.ipa || '暂无音标'} · ${wordInfo.type}`}</small></div>
              <button className={savedWords.includes(selectedWord) ? 'bookmarked' : ''} onClick={() => setSavedWords((items) => items.includes(selectedWord) ? items.filter((item) => item !== selectedWord) : [...items, selectedWord])} title="切换生词收藏" aria-label="切换生词收藏">
                {savedWords.includes(selectedWord) ? <BookmarkCheck size={19} /> : <Bookmark size={19} />}
              </button>
            </div>
            <p className="meaning">{wordInfo.meaning}</p>
            <p className="usage"><Sparkles size={14} />{wordInfo.note}</p>
            <blockquote>{wordInfo.example}</blockquote>
            <span className="dictionary-source">{wordInfo.source ? `释义来源：${wordInfo.source} + MyMemory` : '免费词典查询 · 本地缓存'}</span>
          </div>}
        </aside>
      </main>
      )}

      {wordTooltip && (
        <div
          className={`dictionary-tooltip ${wordTooltip.above ? 'above' : ''}`}
          style={{ left: wordTooltip.x, top: wordTooltip.y }}
          role="tooltip"
        >
          <div><strong>{wordTooltip.word}</strong>{tooltipInfo && <small>{tooltipInfo.ipa || '暂无音标'} · {tooltipInfo.type}</small>}</div>
          <p>{tooltipInfo?.meaning || (tooltipError ? '暂未找到这个词的释义' : '正在查询免费词典…')}</p>
        </div>
      )}

      {statsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setStatsOpen(false)}>
          <section className="stats-modal" role="dialog" aria-modal="true" aria-label="学习统计">
            <div className="modal-head"><div><span>学习统计</span><strong>你的 EchoLine 学习记录</strong></div><button className="icon-button" onClick={() => setStatsOpen(false)} aria-label="关闭"><X size={18} /></button></div>
            <div className="stats-grid">
              <div><Timer size={18} /><strong>{formatStudyTime(stats.totalSeconds)}</strong><span>累计有效播放</span></div>
              <div><Check size={18} /><strong>{learnedVideos.length}</strong><span>已学视频</span></div>
              <div><Library size={18} /><strong>{learnedCourses.length}</strong><span>已学习课程</span></div>
              <div><FolderPlus size={18} /><strong>{courses.length}</strong><span>课程集</span></div>
            </div>
            <div className="course-overview">
              <div className="overview-head"><strong>课程内容</strong><span>连续播放 {LEARNED_THRESHOLD_SECONDS} 秒后计为已学习</span></div>
              {courses.map((course) => (
                <div className="course-row" key={course.id}>
                  <span><Library size={16} /></span>
                  <div><strong>{course.name}</strong><small>{course.items.length} 个视频 · {course.items.filter((item) => stats.videos[item.canonicalUrl]?.learned).length} 个已学习</small></div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {notice && <div className={`toast ${importState === 'error' ? 'error' : ''}`}><Check size={16} />{notice}</div>}
    </div>
  );
}

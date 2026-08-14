import { lazy, Suspense, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Check, LoaderCircle } from 'lucide-react';
import { AppHeader } from './components/AppHeader';
import { StatsModal } from './components/StatsModal';
import { useAppState } from './state/AppState';

const PlayerPage = lazy(() => import('./pages/PlayerPage'));
const CoursesPage = lazy(() => import('./pages/CoursesPage'));
const ReviewPage = lazy(() => import('./pages/ReviewPage'));

export default function App() {
  const { data, loading, error, notice } = useAppState(); const [statsOpen, setStatsOpen] = useState(false);
  if (loading) return <div className="boot-screen"><LoaderCircle className="spin" /><strong>正在打开学习空间</strong></div>;
  if (error || !data) return <div className="boot-screen error-state"><strong>本地服务连接失败</strong><p>{error || '无法读取应用数据'}</p><button onClick={() => window.location.reload()}>重试</button></div>;
  const firstLesson = data.courses.flatMap((course) => course.lessons)[0]?.id;
  return <div className={`app-shell ${data.settings.darkMode ? 'dark-mode' : ''}`}>
    <AppHeader onStats={() => setStatsOpen(true)} />
    <Suspense fallback={<div className="route-loading"><LoaderCircle className="spin" />正在加载…</div>}>
      <Routes>
        <Route path="/" element={<Navigate to="/learn" replace />} />
        <Route path="/learn" element={<Navigate to={data.settings.currentLessonId ? `/learn/${data.settings.currentLessonId}` : (firstLesson ? `/learn/${firstLesson}` : '/learn/courses')} replace />} />
        <Route path="/learn/:lessonId" element={<PlayerPage />} />
        <Route path="/learn/courses" element={<CoursesPage />} />
        <Route path="/learn/review/:group" element={<ReviewPage />} />
        <Route path="*" element={<Navigate to="/learn" replace />} />
      </Routes>
    </Suspense>
    <StatsModal open={statsOpen} onClose={() => setStatsOpen(false)} />
    {notice && <div className="toast" role="status"><Check size={15} />{notice}</div>}
  </div>;
}

import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Check, LoaderCircle } from 'lucide-react';
import { AppHeader } from './components/AppHeader';
import { AuthModal } from './components/AuthModal';
import { StatsModal } from './components/StatsModal';
import { useAppState } from './state/AppState';

const PlayerPage = lazy(() => import('./pages/PlayerPage'));
const CoursesPage = lazy(() => import('./pages/CoursesPage'));
const ReviewPage = lazy(() => import('./pages/ReviewPage'));

export default function App() {
  const { data, loading, error, notice, refresh, notify } = useAppState(); const [statsOpen, setStatsOpen] = useState(false); const [authOpen, setAuthOpen] = useState(() => Boolean(new URLSearchParams(window.location.search).get('authError'))); const location = useLocation(); const navigate = useNavigate();
  useEffect(() => {
    const authError = new URLSearchParams(location.search).get('authError');
    if (!authError) return;
    notify(authError === 'oauth_not_configured'
      ? '第三方登录尚未配置，请使用邮箱登录或联系管理员'
      : authError === 'oauth_network_error'
        ? '服务器无法连接 GitHub 或 Google 授权服务，请检查服务器出网或代理配置'
        : '第三方授权未完成，请重试');
    navigate({ pathname: location.pathname, search: '', hash: location.hash }, { replace: true });
  }, [location.hash, location.pathname, location.search, navigate, notify]);
  if (loading) return <div className="boot-screen"><LoaderCircle className="spin" /><strong>正在打开学习空间</strong></div>;
  if (error || !data) return <div className="boot-screen error-state"><strong>本地服务连接失败</strong><p>{error || '无法读取应用数据'}</p><button onClick={() => window.location.reload()}>重试</button></div>;
  const firstLesson = data.courses.flatMap((course) => course.lessons)[0]?.id;
  return <div className={`app-shell ${data.settings.darkMode ? 'dark-mode' : ''}`}>
    <AppHeader onStats={() => setStatsOpen(true)} onAuth={() => setAuthOpen(true)} />
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
    <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} onAuthenticated={refresh} onNotify={notify} />
    {notice && <div className="toast" role="status"><Check size={15} />{notice}</div>}
  </div>;
}

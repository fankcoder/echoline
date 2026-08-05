import { BarChart3, Library, Moon, Sun } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppState } from '../state/AppState';

function formatTime(seconds = 0) {
  const minutes = Math.floor(seconds / 60); const hours = Math.floor(minutes / 60);
  return hours ? `${hours}小时${minutes % 60}分` : `${minutes}分钟`;
}

export function AppHeader({ onStats }: { onStats: () => void }) {
  const { data, updateSettings } = useAppState(); const navigate = useNavigate(); const location = useLocation();
  const dark = Boolean(data?.settings.darkMode); const inCourses = location.pathname.startsWith('/courses');
  return <header className="topbar">
    <button className="brand brand-button" onClick={() => navigate(data?.settings.currentLessonId ? `/learn/${data.settings.currentLessonId}` : '/')} aria-label="EchoLine 首页">
      <span className="brand-mark"><span /><span /><span /><span /></span><span><strong>EchoLine</strong><small>AI English Studio</small></span>
    </button>
    <div className="topbar-context"><Library size={17} /><span><strong>{inCourses ? '课程管理' : '逐句精听播放器'}</strong><small>{inCourses ? '管理课程与学习内容' : '每一集都有独立字幕与学习进度'}</small></span></div>
    <div className="top-actions">
      <button className="theme-button" onClick={() => void updateSettings({ darkMode: !dark })} aria-label={dark ? '切换浅色模式' : '切换暗色模式'} aria-pressed={dark}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
      <button className="stats-button" onClick={onStats}><BarChart3 size={16} /><span>{formatTime(data?.stats.sessionSeconds)}</span></button>
      <button className="manage-course-button" onClick={() => navigate(inCourses ? (data?.settings.currentLessonId ? `/learn/${data.settings.currentLessonId}` : '/') : '/courses')}><Library size={16} />{inCourses ? '返回播放器' : '课程管理'}</button>
    </div>
  </header>;
}

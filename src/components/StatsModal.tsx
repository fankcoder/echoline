import { BarChart3, Clock3, Play, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useAppState } from '../state/AppState';

function format(seconds = 0) { const m = Math.floor(seconds / 60); return m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分钟` : `${m} 分钟`; }
export function StatsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data } = useAppState(); const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!open) return; closeRef.current?.focus(); const key = (event: KeyboardEvent) => event.key === 'Escape' && onClose(); window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [open, onClose]);
  if (!open || !data) return null;
  const learnedCourses = data.courses.filter((course) => course.lessons.some((lesson) => lesson.cueCount > 0)).length;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="stats-modal" role="dialog" aria-modal="true" aria-labelledby="stats-title">
    <div className="modal-head"><span><small>Learning report</small><strong id="stats-title">学习统计</strong></span><button ref={closeRef} className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></div>
    <div className="stats-grid"><div><Clock3 /><strong>{format(data.stats.sessionSeconds)}</strong><span>学习会话时间</span></div><div><Play /><strong>{format(data.stats.playbackSeconds)}</strong><span>有效播放时间</span></div><div><BarChart3 /><strong>{data.stats.learnedLessons}</strong><span>已学习课时</span></div><div><BarChart3 /><strong>{learnedCourses}</strong><span>已学习课程</span></div></div>
    <div className="course-overview"><div className="overview-head"><strong>课程概览</strong><span>{data.courses.length} 门课程</span></div>{data.courses.map((course) => <div className="course-row" key={course.id}><span><BarChart3 size={15} /></span><div><strong>{course.name}</strong><small>{course.lessons.length} 集 · {course.lessons.reduce((sum, lesson) => sum + lesson.cueCount, 0)} 句字幕</small></div></div>)}</div>
  </section></div>;
}

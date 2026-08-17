import { Chrome, Github, LoaderCircle, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, apiUrl, jsonBody } from '../api';
import type { AuthUser } from '../types';

type Props = { open: boolean; onClose: () => void; onAuthenticated: () => Promise<void>; onNotify: (message: string) => void };

export function AuthModal({ open, onClose, onAuthenticated, onNotify }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [displayName, setDisplayName] = useState(''); const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);
  if (!open) return null;
  const submit = async () => {
    setSubmitting(true);
    try {
      await api<{ user: AuthUser }>(mode === 'login' ? '/api/auth/login' : '/api/auth/register', { method: 'POST', ...jsonBody(mode === 'login' ? { email, password } : { email, password, displayName: displayName.trim() || undefined }) });
      await onAuthenticated();
      onClose();
      onNotify(mode === 'login' ? '登录成功，已恢复云端生词本' : '注册成功，已启用云端生词本');
    } catch (reason) { onNotify((reason as Error).message); }
    finally { setSubmitting(false); }
  };
  const switchMode = () => { setMode((current) => current === 'login' ? 'register' : 'login'); setPassword(''); };
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="auth-modal" onSubmit={(event) => { event.preventDefault(); void submit(); }} role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
    <div className="modal-head"><div><span>EchoLine Account</span><strong id="auth-modal-title">{mode === 'login' ? '登录同步生词本' : '创建账户'}</strong></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X /></button></div>
    <div className="auth-form">{mode === 'register' && <label><span>显示名称</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如：Anhao" maxLength={80} /></label>}<label><span>邮箱</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required /></label><label><span>密码</span><input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'login' ? '输入密码' : '至少 8 位'} minLength={8} required /></label><button className="next-button auth-submit" type="submit" disabled={submitting}>{submitting && <LoaderCircle className="spin" size={15} />}{mode === 'login' ? '登录' : '注册并登录'}</button><button type="button" className="auth-mode-button" onClick={switchMode}>{mode === 'login' ? '没有账号？创建账户' : '已有账号？直接登录'}</button><div className="auth-divider"><span>或</span></div><a className="oauth-button" href={apiUrl('/api/auth/github/start')}><Github size={16} />使用 GitHub 继续</a><a className="oauth-button" href={apiUrl('/api/auth/google/start')}><Chrome size={16} />使用 Google 继续</a></div>
    <p className="auth-note">未登录时，生词和短语只保存在当前浏览器；登录后会自动同步至你的云端账户。</p>
  </form></div>;
}

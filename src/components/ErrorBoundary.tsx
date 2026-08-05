import { Component, type ErrorInfo, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('EchoLine UI error', error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="fatal-error"><strong>页面遇到了问题</strong><p>{this.state.error.message}</p><button onClick={() => window.location.reload()}>重新加载</button></main>;
  }
}

import React from 'react';

interface State {
  error: Error | null;
  componentStack: string;
  copied: boolean;
}

export default class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null, componentStack: '', copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Musician renderer crashed:', error, info.componentStack);
    this.setState({ componentStack: info.componentStack || '' });
  }

  private copyError = async () => {
    const { error, componentStack } = this.state;
    if (!error) return;
    try {
      await navigator.clipboard.writeText(`${error.name}: ${error.message}\n\n${error.stack || ''}\n${componentStack}`);
      this.setState({ copied: true });
      window.setTimeout(() => this.setState({ copied: false }), 1800);
    } catch {
      this.setState({ copied: false });
    }
  };

  render() {
    const { error, copied } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="app-crash" role="alert">
        <section className="app-crash-card" aria-labelledby="app-crash-title">
          <div className="app-crash-mark" aria-hidden="true">!</div>
          <p className="app-crash-eyebrow">Musician</p>
          <h1 id="app-crash-title">화면을 표시하지 못했어</h1>
          <p className="app-crash-copy">오류가 발생했지만 앱을 다시 불러오거나 오류 내용을 복사해 복구를 이어갈 수 있어.</p>
          <details className="app-crash-details">
            <summary>오류 내용 보기</summary>
            <pre>{error.name}: {error.message}{'\n'}{error.stack}</pre>
          </details>
          <div className="app-crash-actions">
            <button className="btn" type="button" onClick={() => void this.copyError()}>{copied ? '복사했어' : '오류 내용 복사'}</button>
            <button className="btn-primary" type="button" onClick={() => window.location.reload()}>앱 다시 불러오기</button>
          </div>
        </section>
      </main>
    );
  }
}

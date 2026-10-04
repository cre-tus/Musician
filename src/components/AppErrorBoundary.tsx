import React from 'react';
import { STRINGS, sanitizeLang } from '../lib/i18n.mjs';

function crashStrings() {
  // The boundary sits above the language provider (and renders when React
  // itself broke), so it reads the last persisted language directly.
  let lang: 'ko' | 'en' = 'ko';
  try {
    lang = sanitizeLang(localStorage.getItem('mudex:lang'));
  } catch {
    /* fall back to Korean */
  }
  return STRINGS[lang];
}

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
    const s = crashStrings();

    return (
      <main className="app-crash" role="alert">
        <section className="app-crash-card" aria-labelledby="app-crash-title">
          <div className="app-crash-mark" aria-hidden="true">!</div>
          <p className="app-crash-eyebrow">Musician</p>
          <h1 id="app-crash-title">{s.crash.title}</h1>
          <p className="app-crash-copy">{s.crash.copy}</p>
          <details className="app-crash-details">
            <summary>{s.crash.showDetails}</summary>
            <pre>{error.name}: {error.message}{'\n'}{error.stack}</pre>
          </details>
          <div className="app-crash-actions">
            <button className="btn" type="button" onClick={() => void this.copyError()}>{copied ? s.crash.copied : s.crash.copyAction}</button>
            <button className="btn-primary" type="button" onClick={() => window.location.reload()}>{s.crash.reload}</button>
          </div>
        </section>
      </main>
    );
  }
}

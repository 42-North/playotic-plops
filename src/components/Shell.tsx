import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useServices } from '../services';
import { Icon, Mascot } from './Art';

type Toast = { id: number; text: string; tone: 'ok' | 'demo' | 'error' };
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function Shell({ children }: { children: ReactNode }) {
  const { api } = useServices();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      {api.mode === 'demo' && (
        <div className="demo-banner" role="note">
          <strong>Demo mode</strong> · Fictional stops. Anything you add stays in this tab only and disappears on reload. Nothing is shared.
        </div>
      )}
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Playotic Plops home">
          <Mascot size={40} />
          <span className="brand-text">
            <span className="brand-name">Playotic Plops</span>
            <span className="brand-tag">Find a place worth plopping.</span>
          </span>
        </Link>
        <nav className="top-nav" aria-label="Main">
          <NavItems />
        </nav>
      </header>
      <main id="main" tabIndex={-1}>{children}</main>
      <nav className="bottom-nav" aria-label="Main">
        <NavItems />
      </nav>
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} role="status">{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function NavItems() {
  return (
    <>
      <NavLink to="/" end className="nav-item"><Icon name="pin" /><span>Explore</span></NavLink>
      <NavLink to="/add" className="nav-item"><Icon name="plus" /><span>Add a stop</span></NavLink>
      <NavLink to="/about" className="nav-item"><Icon name="info" /><span>About</span></NavLink>
    </>
  );
}

export function PageHead({ title, sub, back }: { title: ReactNode; sub?: ReactNode; back?: { to: string; label: string } | 'history' }) {
  return (
    <div className="page-head">
      {back && (
        back === 'history'
          ? <button type="button" className="icon-btn back-btn" onClick={() => history.back()} aria-label="Back"><Icon name="back" /></button>
          : <Link className="icon-btn back-btn" to={back.to} aria-label={back.label}><Icon name="back" /></Link>
      )}
      <div>
        <h1>{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      <Icon name={tone === 'info' ? 'info' : 'alert'} size={18} />
      <div>{children}</div>
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="spinner" role="status">
      <Mascot size={36} className="bob" />
      <span>{label}…</span>
    </div>
  );
}

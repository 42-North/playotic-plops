// Cloudflare Turnstile, loaded lazily only when someone submits something.
// Browsing never loads the Cloudflare script.
import { useCallback, useEffect, useRef } from 'react';
import { useServices } from '../services';

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  execute(idOrEl: string | HTMLElement): void;
  reset(id: string): void;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        loading = null;
        reject(new Error('Could not load the spam check. Check your connection or content blocker.'));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

/**
 * Returns a container ref to render somewhere in the form, and `getToken()` to call on submit.
 * The widget only becomes visible if Cloudflare needs the visitor to interact.
 * Demo mode never contacts Cloudflare.
 */
export function useChallenge(action: string) {
  const { config, api } = useServices();
  const ref = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const pending = useRef<{ resolve: (t: string) => void; reject: (e: Error) => void } | null>(null);

  useEffect(
    () => () => {
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    },
    [],
  );

  const getToken = useCallback(async (): Promise<string> => {
    if (api.mode === 'demo') return 'demo-mode-no-challenge';
    await loadTurnstile();
    const ts = window.turnstile!;
    if (!ref.current) throw new Error('Spam check container missing.');
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.current = null;
        reject(new Error('The spam check timed out. Please try again.'));
      }, 120_000);
      pending.current = {
        resolve: (t) => { clearTimeout(timer); resolve(t); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      };
      if (widget.current == null) {
        widget.current = ts.render(ref.current!, {
          sitekey: config.turnstileSiteKey,
          action,
          theme: 'dark',
          execution: 'execute',
          appearance: 'interaction-only',
          callback: (t: string) => { pending.current?.resolve(t); pending.current = null; },
          'error-callback': () => {
            pending.current?.reject(new Error('The spam check failed. Please try again.'));
            pending.current = null;
          },
        });
      } else {
        ts.reset(widget.current); // tokens are single-use
      }
      ts.execute(ref.current!);
    });
  }, [action, api.mode, config.turnstileSiteKey]);

  return { ref, getToken };
}

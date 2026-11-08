// Original SVG art: the plop mascot, plop rating icons and a consistent stroke icon set.
import type { ReactElement, SVGProps } from 'react';

const TIERS = (
  <>
    <rect x="9" y="61" width="82" height="25" rx="12.5" />
    <rect x="19" y="43" width="62" height="23" rx="11.5" />
    <rect x="30" y="27" width="40" height="20" rx="10" />
    <path d="M41 30c-1-9 7-15 16-21 1 6 6 12 1 20-3 4-9 5-17 1z" />
  </>
);

/** Friendly smiling plop. Purely decorative unless `title` is given. */
export function Mascot({ size = 48, title, mood = 'happy', className }: { size?: number; title?: string; mood?: 'happy' | 'wink'; className?: string }) {
  return (
    <svg viewBox="0 0 100 92" width={size} height={size * 0.92} className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <g fill="#fff0d9" stroke="#fff0d9" strokeWidth="9" strokeLinejoin="round">{TIERS}</g>
      <g fill="#3a1d10" stroke="#3a1d10" strokeWidth="4.5" strokeLinejoin="round">{TIERS}</g>
      <g fill="#94532a">{TIERS}</g>
      <g fill="none" stroke="#c98a52" strokeWidth="3.2" strokeLinecap="round" opacity=".85">
        <path d="M17 70c3-3 8-4 13-4" />
        <path d="M27 50c3-2 6-3 10-3" />
        <path d="M37 33c2-2 4-2 7-2" />
        <path d="M49 21c2-3 4-5 6-7" />
      </g>
      <g fill="#2a130a">
        {mood === 'wink' ? <path d="M35 55q5-4 10 0" stroke="#2a130a" strokeWidth="3" fill="none" strokeLinecap="round" /> : <ellipse cx="40" cy="55" rx="4.6" ry="5.6" />}
        <ellipse cx="60" cy="55" rx="4.6" ry="5.6" />
      </g>
      <g fill="#fff">
        {mood !== 'wink' && <circle cx="41.6" cy="53" r="1.6" />}
        <circle cx="61.6" cy="53" r="1.6" />
      </g>
      <path d="M41 68q9 9 18 0" fill="#5a1f12" stroke="#2a130a" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M45 71.5q5 3 10 0" fill="#e2785c" />
      <ellipse cx="31" cy="64" rx="4.5" ry="2.6" fill="#e08a6a" opacity=".7" />
      <ellipse cx="69" cy="64" rx="4.5" ry="2.6" fill="#e08a6a" opacity=".7" />
    </svg>
  );
}

/** Plop rating icon. `filled` plops count toward the score; empty ones are outlines. */
export function PlopIcon({ size = 20, filled = true, className }: { size?: number; filled?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 100 92" width={size} height={size * 0.92} className={className} aria-hidden="true">
      <g fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={filled ? 0 : 7} strokeLinejoin="round">
        {filled ? TIERS : <path d="M21 86h58a12.5 12.5 0 0 0 0-25h-2a11.5 11.5 0 0 0-7-18 10 10 0 0 0-12-15c3-7 1-13 0-19-9 6-17 12-16 21a10 10 0 0 0-7 14 11.5 11.5 0 0 0-14 17h0a12.5 12.5 0 0 0 0 25z" />}
      </g>
    </svg>
  );
}

/** A row of plops, e.g. 5 plops → 5 filled. Includes an accessible label. */
export function PlopRow({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="plop-row" role="img" aria-label={`${value} out of 5 plops`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <PlopIcon key={i} size={size} filled={i <= value} />
      ))}
    </span>
  );
}

type IconName =
  | 'search' | 'locate' | 'map' | 'list' | 'back' | 'flag' | 'up' | 'down' | 'sparkle' | 'door' | 'key' | 'food'
  | 'clock' | 'pin' | 'nav' | 'pencil' | 'plus' | 'info' | 'swap' | 'check' | 'close' | 'alert' | 'route' | 'compass' | 'refresh' | 'shield' | 'calendar';

const PATHS: Record<IconName, ReactElement> = {
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>,
  locate: <><circle cx="12" cy="12" r="6.5" /><circle cx="12" cy="12" r="2" fill="currentColor" /><path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22" /></>,
  map: <><path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z" /><path d="M9 4v13.5M15 6.5V20" /></>,
  list: <><path d="M8.5 6.5H21M8.5 12H21M8.5 17.5H21" /><circle cx="4" cy="6.5" r="1" fill="currentColor" /><circle cx="4" cy="12" r="1" fill="currentColor" /><circle cx="4" cy="17.5" r="1" fill="currentColor" /></>,
  back: <path d="M20 12H4.5m6-6.5L4 12l6.5 6.5" />,
  flag: <><path d="M5 21V4" /><path d="M5 4.5h11l-2 4 2 4H5" /></>,
  up: <><path d="M7 10.5V20H4.5a1 1 0 0 1-1-1v-7.5a1 1 0 0 1 1-1zM7 10.5 11 3c1.8 0 3 1.4 2.6 3.2L13 9h6a2 2 0 0 1 2 2.3l-1.2 6.9A2.2 2.2 0 0 1 17.6 20H7" /></>,
  down: <><path d="M7 13.5V4H4.5a1 1 0 0 0-1 1v7.5a1 1 0 0 0 1 1zM7 13.5 11 21c1.8 0 3-1.4 2.6-3.2L13 15h6a2 2 0 0 0 2-2.3l-1.2-6.9A2.2 2.2 0 0 0 17.6 4H7" /></>,
  sparkle: <><path d="M12 3.5 13.8 10l6.7 2-6.7 2L12 20.5 10.2 14 3.5 12l6.7-2z" /><path d="M19 3v3M17.5 4.5h3" /></>,
  door: <><rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M12 3v18" /><circle cx="9.5" cy="12" r=".9" fill="currentColor" /><circle cx="14.5" cy="12" r=".9" fill="currentColor" /></>,
  key: <><circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.8 12.2 9.2-9.2M16.5 6.5l2.5 2.5M14 9l2 2" /></>,
  food: <><path d="M6 3v7a2.5 2.5 0 0 0 5 0V3M8.5 3v18" /><path d="M17.5 21V3c-2.2 1-3.5 3.5-3.5 7v4h3.5" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  pin: <><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>,
  nav: <path d="m3.5 11 16-7.5L12 19.5l-1.7-6.8z" />,
  pencil: <><path d="M4 20h4.5L19.5 9a2.5 2.5 0 0 0-3.5-3.5L5 16.5z" /><path d="m14.5 7 3.5 3.5" /></>,
  plus: <><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="M12 8v8M8 12h8" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5" /><circle cx="12" cy="7.8" r=".9" fill="currentColor" /></>,
  swap: <><path d="M8 4v15m0 0-3.5-3.5M8 19l3.5-3.5" /><path d="M16 20V5m0 0-3.5 3.5M16 5l3.5 3.5" /></>,
  check: <path d="m4.5 12.5 4.5 4.5L19.5 6.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  alert: <><path d="M12 3.5 21.5 20h-19z" /><path d="M12 10v4.5" /><circle cx="12" cy="17.2" r=".9" fill="currentColor" /></>,
  route: <><circle cx="6" cy="5.5" r="2.5" /><circle cx="18" cy="18.5" r="2.5" /><path d="M8.5 5.5H15a3.5 3.5 0 0 1 0 7H9a3.5 3.5 0 0 0 0 7h6.5" /></>,
  compass: <><circle cx="12" cy="12" r="8.5" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></>,
  refresh: <><path d="M19.5 11A7.5 7.5 0 0 0 6 6.5L4.5 8" /><path d="M4.5 3.5V8H9" /><path d="M4.5 13A7.5 7.5 0 0 0 18 17.5l1.5-1.5" /><path d="M19.5 20.5V16H15" /></>,
  shield: <><path d="M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6z" /><path d="m9 12 2 2 4-4" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
};

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {PATHS[name]}
    </svg>
  );
}

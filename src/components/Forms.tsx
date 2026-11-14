import { useId, useState, type ReactNode } from 'react';
import type { RatingInput } from '../api/types';
import { todayLocalISO } from '../lib/format';
import type { Place } from '../geo/provider';
import { useServices } from '../services';
import type { LatLng } from '../lib/geo';
import {
  CLEANLINESS_LABEL, FOOD_OPTION_LABEL, KEY_OPTION_LABEL, PLOP_SCALE, PRIVACY_LABEL, PRIVACY_ORDER, RESTROOM_LABEL,
  type Cleanliness, type Food, type KeyRequired, type Restroom, type StallPrivacy,
} from '../lib/rating';
import { Icon, PlopIcon } from './Art';

/** Radio group styled as pill buttons. Native radios keep keyboard and screen-reader behaviour. */
export function Segmented<T extends string>({ legend, value, options, onChange, hint }: {
  legend: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; hint?: string;
}) {
  const name = useId();
  return (
    <fieldset className="seg">
      <legend>{legend}</legend>
      {hint && <p className="hint">{hint}</p>}
      <div className="seg-opts">
        {options.map((o) => (
          <label key={o.value} className={`seg-opt${value === o.value ? ' on' : ''}${o.value === 'unknown' || o.value === 'unspecified' ? ' unsure' : ''}`}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const opts = <T extends string>(labels: Record<T, string>, order: T[]) => order.map((v) => ({ value: v, label: labels[v] }));

export const emptyRating = (): RatingInput => ({
  rating: 0, cleanliness: 'unknown', stall_privacy: 'unknown', key_required: 'unknown', food: 'unknown',
  restroom: 'unspecified', comment: '', visit_date: todayLocalISO(), store_rating: 0,
});

export function PlopPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const name = useId();
  const chosen = PLOP_SCALE.find((p) => p.plops === value);
  return (
    <fieldset className="plop-picker">
      <legend>Overall rating <span className="req">(required)</span></legend>
      <p className="hint">You choose the overall score. The details below inform it but do not calculate it.</p>
      <div className="pp-opts">
        {PLOP_SCALE.map((p) => (
          <label key={p.plops} className={`pp-opt${value === p.plops ? ' on' : ''}`}>
            <input type="radio" name={name} value={p.plops} checked={value === p.plops} onChange={() => onChange(p.plops)} />
            <PlopIcon size={34} />
            <span className="pp-num" aria-hidden="true">{p.plops}</span>
            <span className="sr-only">{p.plops} plop{p.plops > 1 ? 's' : ''}: {p.text}</span>
          </label>
        ))}
      </div>
      <div className="pp-explain" aria-live="polite">
        {chosen ? (
          <>
            <strong>{chosen.plops} plop{chosen.plops > 1 ? 's' : ''} · {chosen.title}.</strong> {chosen.text}
          </>
        ) : (
          <>Pick 1 to 5 plops. <a href="#/guide" target="_blank" rel="noopener">See the plop scale</a></>
        )}
      </div>
    </fieldset>
  );
}

export function RatingFields({ value, onChange }: { value: RatingInput; onChange: (v: RatingInput) => void }) {
  const set = <K extends keyof RatingInput>(k: K) => (v: RatingInput[K]) => onChange({ ...value, [k]: v });
  const commentId = useId();
  const dateId = useId();
  return (
    <>
      <PlopPicker value={value.rating} onChange={set('rating')} />
      <p className="hint">Not sure about something? Leave it on “Not sure”. That is different from a “no”.</p>
      <Segmented<Cleanliness> legend="Cleanliness" value={value.cleanliness} onChange={set('cleanliness')} options={opts(CLEANLINESS_LABEL, ['dirty', 'okay', 'very_clean', 'unknown'])} />
      <Segmented<StallPrivacy> legend="Stall privacy" hint="Floor-to-ceiling means full-height walls and door, like Buc-ee's. “No gaps” is a nearly full door you can't see through." value={value.stall_privacy} onChange={set('stall_privacy')} options={opts(PRIVACY_LABEL, PRIVACY_ORDER)} />
      <Segmented<KeyRequired> legend="Key required?" value={value.key_required} onChange={set('key_required')} options={opts(KEY_OPTION_LABEL, ['yes', 'no', 'unknown'])} />
      <fieldset className="bonus-box">
        <legend>Bonus: food &amp; store <span className="opt">(optional)</span></legend>
        <p className="hint">Just for fun. None of this changes the plop rating, which is only about the bathroom.</p>
        <Segmented<Food> legend="What food do they have?" value={value.food} onChange={set('food')} options={opts(FOOD_OPTION_LABEL, ['none', 'snacks', 'hot_food', 'unknown'])} />
        <Segmented<string> legend="Rate the food & store" value={value.store_rating ? String(value.store_rating) : 'unknown'}
          onChange={(v) => set('store_rating')(v === 'unknown' ? 0 : Number(v))}
          options={[{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' }, { value: '5', label: '5' }, { value: 'unknown', label: 'Skip' }]} />
      </fieldset>
      <Segmented<Restroom> legend="Which restroom? (optional)" value={value.restroom} onChange={set('restroom')} options={opts(RESTROOM_LABEL, ['mens', 'womens', 'all_gender', 'unspecified'])} />
      <div className="field">
        <label htmlFor={dateId}>Visit date</label>
        <input id={dateId} type="date" value={value.visit_date} max={todayLocalISO()} required onChange={(e) => set('visit_date')(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={commentId}>Anything the next traveler should know? <span className="opt">(optional)</span></label>
        <textarea id={commentId} maxLength={280} rows={3} value={value.comment} placeholder="Share a quick note. Please no names or personal details." onChange={(e) => set('comment')(e.target.value)} />
        <p className="hint counter">{value.comment.length}/280</p>
      </div>
    </>
  );
}

/** Text search for a city, address or highway exit. Requests are sent on submit only. */
export function PlaceSearch({ label, placeholder, value, onText, onPick, near, actions, autoFocus }: {
  label: string; placeholder: string; value: string; onText: (t: string) => void; onPick: (p: Place) => void;
  near?: LatLng; actions?: ReactNode; autoFocus?: boolean;
}) {
  const { geo } = useServices();
  const [results, setResults] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const id = useId();

  async function run() {
    if (value.trim().length < 2) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await geo.geocode(value, near);
      if (r.length === 1) {
        onPick(r[0]);
        setResults(null);
      } else setResults(r);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Search failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="place-search">
      <div className="search-row" role="search">
        <label htmlFor={id} className="sr-only">{label}</label>
        <div className="search-box">
          <Icon name="search" />
          <input id={id} type="search" enterKeyHint="search" autoComplete="off" placeholder={placeholder} value={value} autoFocus={autoFocus}
            onChange={(e) => { onText(e.target.value); setResults(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } }} />
          <button type="button" onClick={run} className="btn btn-small" disabled={busy || value.trim().length < 2}>{busy ? 'Searching…' : 'Search'}</button>
        </div>
        {actions}
      </div>
      {err && <p className="field-error" role="alert">{err}</p>}
      {results && (
        <div className="search-results">
          {results.length === 0 ? (
            <p className="muted">No matches. Try a city name, an address, or “I-35 exit 330”.</p>
          ) : (
            <ul aria-label="Search results">
              {results.map((r, i) => (
                <li key={i}>
                  <button type="button" className="result-btn" onClick={() => { onPick(r); setResults(null); }}>
                    <Icon name="pin" size={18} />
                    <span><strong>{r.label}</strong>{r.detail && <small>{r.detail}</small>}{r.approximate && <small className="approx">Approximate: matched the {r.approximate}, not the exact address</small>}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {geo.attribution && <a className="powered" href={geo.attribution.href} target="_blank" rel="noopener">{geo.attribution.text}</a>}
        </div>
      )}
    </div>
  );
}

export function useGeolocation() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function locate(): Promise<LatLng | null> {
    setError(null);
    if (!('geolocation' in navigator)) {
      setError('This browser cannot share location. Search for a place instead.');
      return Promise.resolve(null);
    }
    setBusy(true);
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => { setBusy(false); resolve({ lat: p.coords.latitude, lng: p.coords.longitude }); },
        (e) => {
          setBusy(false);
          setError(e.code === 1 ? 'Location permission was declined. You can still search for a city, address or highway.' : 'Could not get your location. Search for a place instead.');
          resolve(null);
        },
        { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
      );
    });
  }
  return { locate, busy, error };
}

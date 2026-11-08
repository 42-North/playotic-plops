import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, type NearbyStop, type RatingInput } from '../api/types';
import { Icon } from '../components/Art';
import { emptyRating, PlaceSearch, RatingFields, Segmented, useGeolocation } from '../components/Forms';
import { Notice, PageHead, Spinner, useToast } from '../components/Shell';
import { miles } from '../lib/format';
import type { LatLng } from '../lib/geo';
import { CATEGORY_LABEL, type Category } from '../lib/rating';
import { useChallenge } from '../lib/turnstile';
import { useServices } from '../services';

const MapView = lazy(() => import('../components/MapView'));

const DUPLICATE_RADIUS_M = 300;

export default function AddStop() {
  const { api, geo, config } = useServices();
  const nav = useNavigate();
  const toast = useToast();
  const challenge = useChallenge('create_stop');
  const geoLoc = useGeolocation();

  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<LatLng | null>(null);
  const [view, setView] = useState<{ key: string; points: LatLng[] } | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('gas_station');
  const [address, setAddress] = useState('');
  const [rating, setRating] = useState<RatingInput>(emptyRating);
  const [nearby, setNearby] = useState<NearbyStop[] | null>(null);
  const [confirmDistinct, setConfirmDistinct] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Duplicate check whenever the pin moves.
  useEffect(() => {
    if (!pos) return;
    let live = true;
    setNearby(null);
    setConfirmDistinct(false);
    api.stopsNear(pos.lat, pos.lng, DUPLICATE_RADIUS_M).then((n) => live && setNearby(n)).catch(() => live && setNearby([]));
    return () => { live = false; };
  }, [api, pos]);

  const close = useMemo(() => (nearby ?? []).filter((n) => n.distance_m <= 150), [nearby]);

  function place(p: LatLng, label?: string) {
    setPos(p);
    setView({ key: `${p.lat},${p.lng}`, points: [p] });
    if (label && !address) setAddress(label);
  }

  async function onPinMoved(p: LatLng) {
    setPos(p);
    if (!address && geo.reverse) {
      const a = await geo.reverse(p).catch(() => null);
      if (a) setAddress((cur) => cur || a);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!pos) return setErr('Place the stop on the map first.');
    if (name.trim().length < 2) return setErr('Enter the stop’s name.');
    if (address.trim().length < 3) return setErr('Enter an address or highway location.');
    if (!rating.rating) return setErr('Choose an overall rating from 1 to 5 plops.');
    if (close.length && !confirmDistinct) return setErr('There are stops very close by. Rate the existing stop, or confirm this is a different place.');
    setBusy(true);
    try {
      const token = await challenge.getToken();
      const r = await api.createStop({ ...rating, name, category, address, lat: pos.lat, lng: pos.lng, confirm_distinct: confirmDistinct }, token);
      toast(r.shared ? 'Stop added. Thanks for helping the next traveler!' : 'Demo only: this stop exists in this tab only and is not shared.', r.shared ? 'ok' : 'demo');
      nav(`/stop/${r.stopId}`);
    } catch (ex) {
      if (ex instanceof ApiError && ex.candidates?.length) setNearby(ex.candidates);
      setErr(ex instanceof Error ? ex.message : 'The stop was not saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page add-page">
      <PageHead title="Add a stop" sub="Gas stations, travel centers and public rest areas only. Skip places where restroom access is unclear, like hotel lobbies." />
      <form onSubmit={submit} noValidate className="add-grid">
        <section className="add-col" aria-labelledby="where-h">
          <h2 id="where-h" className="step-h"><span className="step-n">1</span> Where is it?</h2>
          <PlaceSearch label="Search an address or place" placeholder="Address, exit, or town" value={query} onText={setQuery}
            onPick={(p) => place(p, p.detail ? `${p.label}, ${p.detail}` : p.label)}
            actions={<button type="button" className="icon-btn" aria-label="Use my location" title="Use my location" onClick={async () => { const p = await geoLoc.locate(); if (p) place(p); }}><Icon name="locate" /></button>} />
          {geoLoc.error && <Notice tone="warn">{geoLoc.error}</Notice>}
          <p className="hint">Then tap the map, or drag the pin, to put it exactly on the building.</p>
          <div className="add-map">
            <Suspense fallback={<div className="map-shell"><Spinner label="Loading map" /></div>}>
              <MapView center={config.defaultCenter} zoom={config.defaultZoom} fit={view} label="Map for placing the new stop. Tap to place the pin."
                onMapClick={(p) => onPinMoved(p)}
                draggablePin={pos ? { ...pos, onMove: onPinMoved } : null}
                markers={(nearby ?? []).map((n) => ({ id: n.id, lat: n.lat, lng: n.lng, text: '•', ariaLabel: `Existing stop: ${n.name}`, kind: 'stop' as const }))} />
            </Suspense>
          </div>
          {pos ? <p className="small muted">Pin at {pos.lat.toFixed(5)}, {pos.lng.toFixed(5)}</p> : <p className="small muted">No position yet.</p>}

          {nearby && nearby.length > 0 && (
            <div className={`dupes ${close.length ? 'warn' : ''}`} role="region" aria-label="Stops already nearby">
              <h3><Icon name="alert" size={18} /> {close.length ? 'Is it one of these?' : 'Already nearby'}</h3>
              <p className="small">If your stop is already listed, rate it instead of adding a duplicate.</p>
              <ul>
                {nearby.map((n) => (
                  <li key={n.id}>
                    <span><strong>{n.name}</strong> · {CATEGORY_LABEL[n.category]} · {miles(n.distance_m)} away{n.status === 'closed' ? ' · marked closed' : ''}</span>
                    {n.status === 'active' && <Link className="btn btn-small btn-outline" to={`/stop/${n.id}/rate`}>Rate this one</Link>}
                  </li>
                ))}
              </ul>
              {close.length > 0 && (
                <label className="check-row">
                  <input type="checkbox" checked={confirmDistinct} onChange={(e) => setConfirmDistinct(e.target.checked)} />
                  <span>None of these. Mine is a different place.</span>
                </label>
              )}
            </div>
          )}
          {nearby && nearby.length === 0 && pos && <p className="small ok-line"><Icon name="check" size={16} /> No other stops listed within {miles(DUPLICATE_RADIUS_M)}.</p>}

          <h2 className="step-h"><span className="step-n">2</span> What is it?</h2>
          <div className="field">
            <label htmlFor="stop-name">Name</label>
            <input id="stop-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Corner Fuel #12" required />
          </div>
          <Segmented<Category> legend="Type of place" value={category} onChange={setCategory}
            options={(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />
          <div className="field">
            <label htmlFor="stop-addr">Address or highway location</label>
            <input id="stop-addr" maxLength={200} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. 123 Main St, or I-35 exit 330 southbound" required />
          </div>
        </section>

        <section className="add-col" aria-labelledby="rate-h">
          <h2 id="rate-h" className="step-h"><span className="step-n">3</span> Give the original plop</h2>
          <p className="hint">This first rating is kept as the stop’s original rating. Later visitors add crowd ratings and can say whether they agree with yours.</p>
          <RatingFields value={rating} onChange={setRating} />
          <div ref={challenge.ref} className="challenge-slot" />
          {err && <p className="field-error" role="alert">{err}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Adding…' : 'Add stop'}</button>
          <p className="small muted center">No account. No name. No email. <Link to="/privacy">Privacy</Link></p>
        </section>
      </form>
    </div>
  );
}

import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { MyState, PublicRating, StopDetail as Detail } from '../api/types';
import { Icon, Mascot } from '../components/Art';
import { Notice, Spinner, useToast } from '../components/Shell';
import { PinText, PlopsInline } from '../components/StopBits';
import { confidence, daysAgo, plural, ratingCount, shortDate } from '../lib/format';
import {
  CATEGORY_LABEL, CLEANLINESS_LABEL, FOOD_LABEL, KEY_LABEL, PRIVACY_LABEL, RESTROOM_LABEL,
  type Cleanliness, type Food, type KeyRequired, type StallPrivacy,
} from '../lib/rating';
import { useChallenge } from '../lib/turnstile';
import { useServices } from '../services';
import { ReportDialog } from '../components/ReportDialog';

const MapView = lazy(() => import('../components/MapView'));

export default function StopDetail() {
  const { id = '' } = useParams();
  const { api } = useServices();
  const toast = useToast();
  const [stop, setStop] = useState<Detail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<MyState | null>(null);
  const [voting, setVoting] = useState(false);
  const [report, setReport] = useState<{ ratingId: string | null } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const challenge = useChallenge('vote');

  const load = useCallback(async () => {
    try {
      setError(null);
      setStop(await api.stopDetail(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this stop.');
    }
    api.myState(id).then(setMe).catch(() => setMe(null));
  }, [api, id]);

  useEffect(() => {
    load();
  }, [load]);

  async function vote(v: 'agree' | 'disagree') {
    if (!stop) return;
    const next = me?.vote === v ? 'none' : v;
    setVoting(true);
    try {
      const token = await challenge.getToken();
      const r = await api.setAgreement(stop.id, next, token);
      setMe((m) => ({ is_creator: m?.is_creator ?? false, rating: m?.rating ?? null, vote: next === 'none' ? null : next }));
      await load();
      toast(r.shared ? (next === 'none' ? 'Vote removed.' : 'Vote saved.') : 'Demo only: vote kept in this tab, not shared.', r.shared ? 'ok' : 'demo');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Vote not saved.', 'error');
    } finally {
      setVoting(false);
    }
  }

  if (error) return <div className="page"><Notice tone="error">{error} <button className="link-btn" onClick={load}>Try again</button></Notice></div>;
  if (stop === undefined) return <div className="page"><Spinner label="Loading the plop report" /></div>;
  if (stop === null) {
    return (
      <div className="page narrow empty">
        <Mascot size={72} mood="wink" />
        <h1>Stop not found</h1>
        <p>It may have been removed by moderation, or the link is wrong.</p>
        <Link className="btn btn-primary" to="/">Back to explore</Link>
      </div>
    );
  }

  const pin = PinText(stop);
  const conf = confidence(stop.crowd_count);
  const dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${stop.lat.toFixed(6)},${stop.lng.toFixed(6)}`;
  const appleUrl = `https://maps.apple.com/?daddr=${stop.lat.toFixed(6)},${stop.lng.toFixed(6)}`;
  const crowdRatings = stop.recent_ratings.filter((r) => !r.is_original);
  const original = stop.recent_ratings.find((r) => r.is_original);

  return (
    <div className="page detail">
      <div className="detail-top">
        <Link to="/" className="icon-btn back-btn" aria-label="Back to explore"><Icon name="back" /></Link>
        <span className="eyebrow">The plop report</span>
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setReport({ ratingId: null })}><Icon name="flag" size={16} /> Report a problem</button>
      </div>

      <h1 className="detail-name">{stop.name}</h1>
      <p className="detail-sub">{CATEGORY_LABEL[stop.category]} · Public restroom</p>
      <p className="detail-addr"><Icon name="pin" size={16} /> {stop.address}</p>
      {stop.status === 'closed' && <Notice tone="warn">This stop has been marked closed. It is kept for reference and not accepting new ratings.</Notice>}

      <div className="detail-grid">
        <div className="detail-col">
          <div className="score-panels">
            <section className="panel-original" aria-labelledby="orig-h">
              <h2 id="orig-h" className="panel-label">Original</h2>
              {stop.original_rating != null ? (
                <>
                  <p className="big-plops"><span className="num">{stop.original_rating}</span> plop{stop.original_rating > 1 ? 's' : ''}</p>
                  <p className="muted small">First submission{original ? `, visited ${shortDate(original.visit_date)}` : ''}</p>
                </>
              ) : (
                <p className="muted">Removed by moderation</p>
              )}
            </section>
            <section className="panel-crowd" aria-labelledby="crowd-h">
              <h2 id="crowd-h" className="panel-label">Crowd</h2>
              {stop.crowd_count > 0 ? (
                <>
                  <p className="crowd-big"><span className="num">{Number(stop.crowd_avg).toFixed(1)}</span><span className="of">/ 5</span></p>
                  <p className="small">{ratingCount(stop.crowd_count)}{conf ? ` · ${conf}` : ''}</p>
                </>
              ) : (
                <>
                  <p className="crowd-none">No crowd ratings yet</p>
                  <p className="small muted">The original rating is not counted here.</p>
                </>
              )}
            </section>
          </div>

          {stop.original_rating != null && (
            <section className="agree-box" aria-labelledby="agree-h">
              <h2 id="agree-h">Was the original {stop.original_rating}-plop rating fair?</h2>
              <p className="agree-counts"><span className="agree-n">{stop.agree_count} agree</span> · <span className="disagree-n">{stop.disagree_count} disagree</span></p>
              {me?.is_creator ? (
                <p className="muted small">You submitted this original rating, so you cannot vote on it.</p>
              ) : me?.vote === 'removed' ? (
                <p className="muted small">Your earlier vote was removed by moderation.</p>
              ) : stop.status === 'active' ? (
                <div className="agree-btns">
                  <button type="button" className="btn btn-toggle" aria-pressed={me?.vote === 'agree'} disabled={voting} onClick={() => vote('agree')}><Icon name="up" /> Agree</button>
                  <button type="button" className="btn btn-toggle" aria-pressed={me?.vote === 'disagree'} disabled={voting} onClick={() => vote('disagree')}><Icon name="down" /> Disagree</button>
                </div>
              ) : null}
              {me?.vote === 'agree' || me?.vote === 'disagree' ? <p className="muted small">Tap your choice again to remove your vote.</p> : null}
              <p className="muted small">Agreement votes are separate from crowd ratings and never change the crowd score.</p>
              <div ref={challenge.ref} className="challenge-slot" />
            </section>
          )}

          <section className="criteria" aria-labelledby="crit-h">
            <h2 id="crit-h" className="section-h">What travelers reported</h2>
            <p className="muted small">Each line shows the most recent visit that reported it, with counts from all visible ratings.</p>
            <dl>
              <Criterion icon="sparkle" label="Cleanliness" value={stop.cleanliness ? CLEANLINESS_LABEL[stop.cleanliness as Cleanliness] : null} date={stop.cleanliness_visit_date} tally={stop.tallies.cleanliness} labels={CLEANLINESS_LABEL} />
              <Criterion icon="door" label="Stall privacy" value={stop.stall_privacy ? PRIVACY_LABEL[stop.stall_privacy as StallPrivacy] : null} date={stop.stall_privacy_visit_date} tally={stop.tallies.stall_privacy} labels={PRIVACY_LABEL} />
              <Criterion icon="key" label="Access" value={stop.key_required ? KEY_LABEL[stop.key_required as KeyRequired] : null} date={stop.key_required_visit_date} tally={stop.tallies.key_required} labels={KEY_LABEL} />
              <Criterion icon="food" label="Food (perk, not scored)" value={stop.food ? FOOD_LABEL[stop.food as Food] : null} date={stop.food_visit_date} tally={stop.tallies.food} labels={FOOD_LABEL} />
            </dl>
            {stop.last_visit_date && <p className="small"><Icon name="clock" size={15} /> Most recent visit {daysAgo(stop.last_visit_date)} ({shortDate(stop.last_visit_date)})</p>}
          </section>

          <div className="detail-actions">
            <a className="btn btn-primary" href={dirUrl} target="_blank" rel="noopener noreferrer"><Icon name="nav" /> Get directions</a>
            {me?.is_creator ? (
              <span className="muted small">You added this stop and its original rating.</span>
            ) : stop.status === 'active' ? (
              <Link className="btn btn-outline" to={`/stop/${stop.id}/rate`}><Icon name="pencil" /> {me?.rating ? 'Edit your rating' : 'Add your rating'}</Link>
            ) : null}
          </div>
          <p className="small muted">Opens Google Maps. <a href={appleUrl} target="_blank" rel="noopener noreferrer">Use Apple Maps instead</a>.</p>
        </div>

        <div className="detail-col">
          <div className="detail-map">
            <Suspense fallback={<div className="map-shell"><Spinner label="Loading map" /></div>}>
              <MapView center={stop} zoom={14} interactive={false} label={`Map showing ${stop.name}`}
                markers={[{ id: stop.id, lat: stop.lat, lng: stop.lng, ...pin, ariaLabel: stop.name, kind: 'stop' }]} />
            </Suspense>
          </div>
          <section aria-labelledby="recent-h">
            <h2 id="recent-h" className="section-h">Recent ratings</h2>
            {stop.recent_ratings.length === 0 && <p className="muted">No visible ratings.</p>}
            <ul className="rating-list">
              {[...(original ? [original] : []), ...crowdRatings].slice(0, showAll ? 25 : 6).map((r) => (
                <RatingItem key={r.id} r={r} onReport={() => setReport({ ratingId: r.id })} />
              ))}
            </ul>
            {!showAll && stop.recent_ratings.length > 6 && (
              <button type="button" className="btn btn-ghost btn-block" onClick={() => setShowAll(true)}>Show more recent ratings</button>
            )}
            {stop.crowd_count > 25 && <p className="muted small">Showing the most recent ratings. The crowd score uses all {plural(stop.crowd_count, 'rating')}.</p>}
          </section>
        </div>
      </div>

      {report && <ReportDialog stopId={stop.id} ratingId={report.ratingId} onClose={() => setReport(null)} />}
    </div>
  );
}

function Criterion<T extends string>({ icon, label, value, date, tally, labels }: {
  icon: 'sparkle' | 'door' | 'key' | 'food'; label: string; value: string | null; date: string | null;
  tally: Partial<Record<T, number>>; labels: Record<T, string>;
}) {
  const parts = Object.entries(tally as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${labels[k as T]} ${n}`);
  return (
    <div className="crit-row">
      <dt><Icon name={icon} size={18} /> {label}</dt>
      <dd>
        {value ? (
          <>
            <strong>{value}</strong>
            <span className="prov">Latest visit reporting it: {date ? shortDate(date) : 'unknown date'}</span>
            {parts.length > 1 && <span className="prov">All reports: {parts.join(' · ')}</span>}
          </>
        ) : (
          <span className="muted">Unknown. No one has reported this yet.</span>
        )}
      </dd>
    </div>
  );
}

function RatingItem({ r, onReport }: { r: PublicRating; onReport: () => void }) {
  const details = [
    r.cleanliness !== 'unknown' && CLEANLINESS_LABEL[r.cleanliness],
    r.stall_privacy !== 'unknown' && PRIVACY_LABEL[r.stall_privacy],
    r.key_required !== 'unknown' && KEY_LABEL[r.key_required],
    r.food !== 'unknown' && FOOD_LABEL[r.food],
    r.restroom !== 'unspecified' && `${RESTROOM_LABEL[r.restroom]} room`,
  ].filter(Boolean);
  const edited = r.updated_at.slice(0, 16) !== r.created_at.slice(0, 16);
  return (
    <li className="rating-item">
      <div className="ri-head">
        <Mascot size={34} />
        <div>
          <p className="ri-score"><PlopsInline n={r.rating} /> {r.is_original && <span className="tag">Original</span>}</p>
          <p className="muted small">
            Visited {shortDate(r.visit_date)} · submitted {daysAgo(r.created_at)}{edited ? ` · edited ${daysAgo(r.updated_at)}` : ''}
          </p>
        </div>
        <button type="button" className="link-btn report-link" onClick={onReport} aria-label="Report this rating">Report</button>
      </div>
      {/* Comments are rendered as plain text. React escapes them; no HTML is interpreted. */}
      {r.comment && <p className="ri-comment">“{r.comment}”</p>}
      {details.length > 0 && <p className="small ri-details">{details.join(' · ')}</p>}
    </li>
  );
}


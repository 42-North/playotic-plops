import { Link } from 'react-router-dom';
import type { StopSummary } from '../api/types';
import { confidence, crowdScore, daysAgo, plural, ratingCount } from '../lib/format';
import { CATEGORY_LABEL, CLEANLINESS_LABEL, FOOD_LABEL, KEY_LABEL, PRIVACY_LABEL, scoreTone } from '../lib/rating';
import { Icon, PlopIcon } from './Art';

/** The crowd score is the headline; the count is always shown beside it. */
export function CrowdBadge({ s, size = 'md' }: { s: Pick<StopSummary, 'crowd_avg' | 'crowd_count'>; size?: 'md' | 'lg' }) {
  if (s.crowd_count === 0) {
    return (
      <div className={`crowd-badge empty ${size}`}>
        <span className="cb-none">No crowd ratings yet</span>
      </div>
    );
  }
  return (
    <div className={`crowd-badge tone-${scoreTone(s.crowd_avg)} ${size}`} aria-label={`Crowd score ${crowdScore(s.crowd_avg)} out of 5 from ${ratingCount(s.crowd_count)}`}>
      <span className="cb-score">{crowdScore(s.crowd_avg)}</span>
      <span className="cb-label">CROWD / 5</span>
      <span className="cb-count">{plural(s.crowd_count, 'rating')}</span>
    </div>
  );
}

export function OriginalLine({ s }: { s: Pick<StopSummary, 'original_rating'> }) {
  if (s.original_rating == null) return <span className="muted">Original rating removed</span>;
  return (
    <span className="orig-line">
      Original: {plural(s.original_rating, 'plop')}
    </span>
  );
}

export function CriteriaChips({ s, compact }: { s: StopSummary; compact?: boolean }) {
  const chips: { icon: Parameters<typeof Icon>[0]['name']; text: string }[] = [];
  if (s.stall_privacy) chips.push({ icon: 'door', text: PRIVACY_LABEL[s.stall_privacy] });
  if (s.cleanliness) chips.push({ icon: 'sparkle', text: CLEANLINESS_LABEL[s.cleanliness] });
  if (s.key_required) chips.push({ icon: 'key', text: KEY_LABEL[s.key_required] });
  if (s.food && !compact) chips.push({ icon: 'food', text: FOOD_LABEL[s.food] });
  else if (s.food && (s.food === 'hot_food' || s.food === 'snacks')) chips.push({ icon: 'food', text: FOOD_LABEL[s.food] });
  if (!chips.length) return <p className="chips-empty">No details reported yet</p>;
  return (
    <ul className="crit-chips" aria-label="Latest reported details">
      {chips.map((c) => (
        <li key={c.icon}><Icon name={c.icon} size={15} /> {c.text}</li>
      ))}
    </ul>
  );
}

export function StopCard({ s, distance, extra, selected, onFocus }: { s: StopSummary; distance?: string; extra?: React.ReactNode; selected?: boolean; onFocus?: () => void }) {
  const conf = confidence(s.crowd_count);
  return (
    <article className={`stop-card${selected ? ' selected' : ''}`} onMouseEnter={onFocus}>
      <div className="sc-main">
        <h3 className="sc-title">
          <Link to={`/stop/${s.id}`} className="stretched">{s.name}</Link>
        </h3>
        <p className="sc-meta">
          {CATEGORY_LABEL[s.category]}
          {distance && <> · {distance}</>}
        </p>
        {extra}
        <p className="sc-meta">
          <OriginalLine s={s} />
          {conf && <> · <span className="conf">{conf}</span></>}
        </p>
        <CriteriaChips s={s} compact />
        {s.last_visit_date && <p className="sc-fresh"><Icon name="clock" size={14} /> Last visit {daysAgo(s.last_visit_date)}</p>}
        {s.status === 'closed' && <p className="badge-closed">Marked closed</p>}
      </div>
      <CrowdBadge s={s} />
    </article>
  );
}

export function PinText(s: StopSummary) {
  if (s.crowd_count > 0) return { text: crowdScore(s.crowd_avg), tone: scoreTone(s.crowd_avg) };
  return { text: s.original_rating ? `${s.original_rating}` : '?', tone: 'none' as const };
}

export function pinAria(s: StopSummary) {
  return s.crowd_count > 0
    ? `${s.name}: crowd ${crowdScore(s.crowd_avg)} out of 5 from ${ratingCount(s.crowd_count)}`
    : `${s.name}: no crowd ratings yet, original ${s.original_rating ?? 'removed'} plops`;
}

export function PlopsInline({ n }: { n: number }) {
  return (
    <span className="plops-inline" aria-label={`${n} plops`}>
      <PlopIcon size={20} /> {n}
    </span>
  );
}

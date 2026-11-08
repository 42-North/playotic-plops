import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { RatingInput, StopDetail } from '../api/types';
import { Icon } from '../components/Art';
import { emptyRating, RatingFields } from '../components/Forms';
import { Notice, PageHead, Spinner, useToast } from '../components/Shell';
import { useChallenge } from '../lib/turnstile';
import { useServices } from '../services';

export default function RateStop() {
  const { id = '' } = useParams();
  const { api } = useServices();
  const nav = useNavigate();
  const toast = useToast();
  const challenge = useChallenge('rate');
  const [stop, setStop] = useState<StopDetail | null | undefined>(undefined);
  const [value, setValue] = useState<RatingInput>(emptyRating);
  const [editing, setEditing] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const s = await api.stopDetail(id);
        if (!live) return;
        setStop(s);
        if (s && s.status !== 'active') setBlocked('This stop is marked closed and is not accepting ratings.');
        const me = await api.myState(id).catch(() => null);
        if (!live || !me) return;
        if (me.is_creator) setBlocked('You submitted the original rating for this stop from this browser, so you cannot also add a crowd rating to it.');
        else if (me.rating?.status === 'hidden') setBlocked('Your earlier rating for this stop was removed by moderation.');
        else if (me.rating) {
          setEditing(true);
          setValue({ ...me.rating, comment: me.rating.comment ?? '' });
        }
      } catch (e) {
        if (live) setErr(e instanceof Error ? e.message : 'Could not load this stop.');
      }
    })();
    return () => { live = false; };
  }, [api, id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.rating) {
      setErr('Choose an overall rating from 1 to 5 plops.');
      document.querySelector<HTMLInputElement>('.plop-picker input')?.focus();
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const token = await challenge.getToken();
      const r = await api.submitRating(id, value, token);
      toast(
        r.shared ? (r.updated ? 'Your rating was updated.' : 'Thanks! Your plops were added to the crowd score.') : 'Demo only: kept in this tab, not shared.',
        r.shared ? 'ok' : 'demo',
      );
      nav(`/stop/${id}`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Your rating was not saved.');
    } finally {
      setBusy(false);
    }
  }

  if (stop === undefined && !err) return <div className="page"><Spinner /></div>;
  if (stop === null) return <div className="page narrow"><Notice tone="error">That stop could not be found.</Notice><Link to="/">Back to explore</Link></div>;

  return (
    <div className="page narrow">
      <PageHead back={{ to: `/stop/${id}`, label: 'Back to stop' }} title="Give a plop." sub={stop ? <>Rate <strong>{stop.name}</strong></> : null} />
      <p className="lede">Your rating joins the crowd score. {editing && <strong>You rated this stop before. Saving replaces your earlier rating.</strong>}</p>
      {blocked ? (
        <Notice tone="warn">{blocked}</Notice>
      ) : (
        <form className="rate-form" onSubmit={submit} noValidate>
          <RatingFields value={value} onChange={setValue} />
          <div ref={challenge.ref} className="challenge-slot" />
          {err && <p className="field-error" role="alert">{err}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Saving…' : value.rating ? `${editing ? 'Update to' : 'Submit'} ${value.rating} plop${value.rating > 1 ? 's' : ''}` : 'Submit rating'}
          </button>
          <p className="small muted center">No account. No name. No email. <Link to="/privacy">How this works</Link> · <Link to="/guide">The plop scale</Link></p>
        </form>
      )}
      {err && blocked && <p className="field-error">{err}</p>}
      <p className="small"><Link to={`/stop/${id}`}><Icon name="back" size={14} /> Back to the plop report</Link></p>
    </div>
  );
}

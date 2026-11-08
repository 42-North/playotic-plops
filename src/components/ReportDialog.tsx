import { useEffect, useId, useRef, useState } from 'react';
import { REPORT_REASON_LABEL, type ReportReason } from '../lib/rating';
import { useChallenge } from '../lib/turnstile';
import { useServices } from '../services';
import { Icon } from './Art';
import { useToast } from './Shell';

export function ReportDialog({ stopId, ratingId, onClose }: { stopId: string; ratingId: string | null; onClose: () => void }) {
  const { api } = useServices();
  const toast = useToast();
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<ReportReason | ''>('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const challenge = useChallenge('report');
  const id = useId();

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason) {
      setErr('Choose a reason.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const token = await challenge.getToken();
      const r = await api.report(stopId, ratingId, reason, details, token);
      toast(r.shared ? 'Thanks. The report was sent privately to the moderator.' : 'Demo only: report not sent anywhere.', r.shared ? 'ok' : 'demo');
      onClose();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Report not sent.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="dialog" aria-labelledby={`${id}-h`} onClose={onClose} onCancel={onClose}>
      <form onSubmit={submit}>
        <div className="dialog-head">
          <h2 id={`${id}-h`}>{ratingId ? 'Report this rating' : 'Report a problem'}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <p className="small muted">Reports are private. Only the site owner can read them. A report is not a vote, and nothing is removed automatically.</p>
        <fieldset className="report-reasons">
          <legend>Reason</legend>
          {(Object.keys(REPORT_REASON_LABEL) as ReportReason[]).map((k) => (
            <label key={k} className="radio-row">
              <input type="radio" name={`${id}-reason`} value={k} checked={reason === k} onChange={() => setReason(k)} />
              <span>{REPORT_REASON_LABEL[k]}</span>
            </label>
          ))}
        </fieldset>
        <div className="field">
          <label htmlFor={`${id}-d`}>Details <span className="opt">(optional)</span></label>
          <textarea id={`${id}-d`} rows={3} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="What should the moderator know? Please do not include personal details." />
        </div>
        <div ref={challenge.ref} className="challenge-slot" />
        {err && <p className="field-error" role="alert">{err}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send report'}</button>
        </div>
      </form>
    </dialog>
  );
}

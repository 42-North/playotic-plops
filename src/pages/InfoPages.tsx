import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mascot, PlopRow } from '../components/Art';
import { PageHead } from '../components/Shell';
import { forgetToken, peekToken } from '../lib/identity';
import { PLOP_SCALE } from '../lib/rating';
import { useServices } from '../services';

export function Guide() {
  return (
    <div className="page narrow prose">
      <PageHead back="history" title="The plop scale" sub="Pick the overall score yourself. The details you add help others, but they don't calculate it." />
      <ol className="scale-list">
        {PLOP_SCALE.slice().reverse().map((p) => (
          <li key={p.plops}>
            <PlopRow value={p.plops} size={22} />
            <div>
              <h2>{p.plops} plop{p.plops > 1 ? 's' : ''} · {p.title}</h2>
              <p>{p.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <h2>Three different numbers</h2>
      <dl className="defs">
        <dt>Original rating</dt>
        <dd>The first person’s 1–5 plop rating when they added the stop. It is kept as-is.</dd>
        <dt>Agreement</dt>
        <dd>Later visitors can agree or disagree with that original rating. These votes are counted separately and never change the crowd score.</dd>
        <dt>Crowd rating</dt>
        <dd>The average of everyone else’s independent 1–5 ratings, shown to one decimal with how many ratings it is based on. The original rating is not included. A 4.6 from 2 ratings is a much shakier signal than a 4.6 from 200, so the count is always shown.</dd>
      </dl>
      <h2>Details</h2>
      <p>Cleanliness, stall privacy and whether a key is needed describe the bathroom. Food is a perk and never affects the score. “Not sure” means unknown, which is different from “no”. Details on a stop show the latest visit that reported them, with the date, because places change.</p>
      <p><Link to="/">Back to finding a good plop</Link></p>
    </div>
  );
}

export function About() {
  const { api } = useServices();
  return (
    <div className="page narrow prose">
      <div className="about-hero">
        <Mascot size={96} />
        <div>
          <h1>Playotic Plops</h1>
          <p className="lede">Find a place worth plopping. A crowdsourced guide to clean, convenient public bathrooms for people on the road.</p>
        </div>
      </div>
      <p>Playotic Plops covers <strong>gas stations, travel centers and public rest areas</strong>, the places where restrooms are generally open to travelers. It leaves out places where access is unclear, like hotel lobbies.</p>
      <p>Anyone can browse, add a stop, rate a bathroom or vote without an account, email or social login. No photos, ever.</p>
      <ul className="link-list">
        <li><Link to="/guide">The plop scale and how scores work</Link></li>
        <li><Link to="/privacy">Privacy: what is and isn't collected</Link></li>
        <li><Link to="/add">Add a stop</Link></li>
      </ul>
      <h2>Moderation</h2>
      <p>Use “Report a problem” on a stop or a rating. Reports go privately to the site owner, who can hide abusive content, mark closures and fix map positions. A low score or lots of disagreement is not a reason to remove a stop; only reports reviewed by a person are.</p>
      <h2>This copy of the app</h2>
      <p>{api.mode === 'demo'
        ? 'You are using demo mode. All stops are fictional and anything you add disappears when you reload.'
        : 'You are using the live, shared version. Ratings you submit are stored on the Playotic Plops server and shown to everyone.'}</p>
      <p className="small muted">Map data © OpenStreetMap contributors. Map tiles by OpenFreeMap / OpenMapTiles. Address search by Nominatim and driving routes by the FOSSGIS OSRM server, both free community services built on OpenStreetMap.</p>
    </div>
  );
}

export function Privacy() {
  const [hasToken, setHasToken] = useState(() => !!peekToken());
  return (
    <div className="page narrow prose">
      <PageHead back="history" title="Privacy" sub="Plain answers about what this site keeps." />
      <h2>No accounts</h2>
      <p>There are no visitor accounts, including hidden “anonymous” sign-ins. We never ask for your name, email, phone number or social login. There are no analytics, ads, session recordings or social media trackers.</p>

      <h2>The browser token</h2>
      <p>The first time you submit a stop, rating, vote or report, your browser creates a random code and keeps it in this site’s local storage. It is only used so you can edit your own rating, change your vote, and so the server can limit repeat or rapid submissions. Just browsing never creates it.</p>
      <p>The server stores only a keyed hash of that code, not the code itself, alongside what you submitted. That hash is a pseudonymous identifier: it is not your name, but it does link your contributions to each other.</p>
      <p>Clearing site data or switching browsers creates a new token. That means this site <strong>cannot guarantee one person, one vote</strong>. Rate limits, a spam check, and reports help, but they are not perfect.</p>
      <p>{hasToken ? 'This browser has a token.' : 'This browser does not have a token.'}{' '}
        {hasToken && (
          <button type="button" className="link-btn" onClick={() => { forgetToken(); setHasToken(false); }}>
            Forget it
          </button>
        )}
        {hasToken && ' (You will no longer be able to edit earlier ratings from this browser. Your public ratings stay published.)'}
      </p>

      <h2>Location</h2>
      <p>Your location is only requested if you tap “Use my location”. It is used in your browser to center the map and sort results. Precise start points, destinations and your current location are not stored in the Playotic Plops database or in your browser storage. Search text is sent to Nominatim, and route start/end points (plus any stop being checked for a detour) are sent to the FOSSGIS routing server, to answer the request. The routing server notes that route requests are saved in its log files.</p>
      <p>Stops you add are saved with the map position of the stop itself, which is public.</p>

      <h2>Spam and abuse checks</h2>
      <p>Submissions use Cloudflare Turnstile, a spam check that runs only when you submit something. Cloudflare receives information about your browser and network to do this. For rate limiting, the server briefly stores a keyed hash of your network address, rotated daily and deleted within two days. Raw IP addresses are not stored in the application database.</p>

      <h2>Who else sees network information</h2>
      <p>No account does not mean no data exists. Like any website, these services see your IP address and browser details when you use the site: GitHub Pages (hosting), Supabase (database and backend), OpenFreeMap (map tiles), Nominatim and FOSSGIS (search and routes) and Cloudflare (spam check, only when submitting). They may keep their own logs under their own policies.</p>

      <h2>What is public</h2>
      <p>Stop names, addresses, positions, ratings, details, comments, visit dates and submission times are public. Please don’t put names or personal details in comments. Reports and their text are private to the site owner.</p>
    </div>
  );
}

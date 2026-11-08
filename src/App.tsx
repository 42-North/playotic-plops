import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Mascot } from './components/Art';
import { Shell, Spinner } from './components/Shell';
import Explore from './pages/Explore';
import { About, Guide, Privacy } from './pages/InfoPages';
import { ExploreProvider, ServicesProvider, type Services } from './services';

const StopDetail = lazy(() => import('./pages/StopDetail'));
const RateStop = lazy(() => import('./pages/RateStop'));
const AddStop = lazy(() => import('./pages/AddStop'));

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (pathname !== '/') window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export function AppRoutes() {
  return (
    <Shell>
      <ScrollTop />
      <Suspense fallback={<div className="page"><Spinner /></div>}>
        <Routes>
          <Route path="/" element={<Explore />} />
          <Route path="/stop/:id" element={<StopDetail />} />
          <Route path="/stop/:id/rate" element={<RateStop />} />
          <Route path="/add" element={<AddStop />} />
          <Route path="/guide" element={<Guide />} />
          <Route path="/about" element={<About />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Shell>
  );
}

function NotFound() {
  return (
    <div className="page narrow empty">
      <Mascot size={72} mood="wink" />
      <h1>Wrong turn</h1>
      <p>That page doesn’t exist.</p>
      <a className="btn btn-primary" href="#/">Back to explore</a>
    </div>
  );
}

/** Hash routing keeps deep links and refreshes working under a GitHub Pages repository subpath. */
export default function App({ services }: { services: Services }) {
  return (
    <ServicesProvider value={services}>
      <ExploreProvider>
        <HashRouter>
          <AppRoutes />
        </HashRouter>
      </ExploreProvider>
    </ServicesProvider>
  );
}

export function ConfigErrorScreen({ message }: { message: string }) {
  return (
    <main className="page narrow config-error">
      <Mascot size={80} mood="wink" />
      <h1>Playotic Plops isn’t configured yet</h1>
      <p role="alert">{message}</p>
      <p>This build was set to live mode, so it will not show demo data instead. The site owner needs to add the missing settings and redeploy. See the README’s “Go live” checklist.</p>
    </main>
  );
}

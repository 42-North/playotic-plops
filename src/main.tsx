import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/fredoka/index.css';
import '@fontsource-variable/nunito/index.css';
import './styles.css';
import App, { ConfigErrorScreen } from './App';
import { createLiveApi } from './api/live';
import { config } from './config';
import { createDemoApi } from './demo/demoApi';
import { createDemoGeo } from './geo/demoGeo';
import { createGeoapify } from './geo/geoapify';

const root = createRoot(document.getElementById('root')!);

if (config.configError) {
  // Live mode was requested but is incomplete: show an error, never demo data.
  root.render(<ConfigErrorScreen message={config.configError} />);
} else {
  const api = config.mode === 'live' ? createLiveApi(config) : createDemoApi();
  const geo = config.geoapifyKey ? createGeoapify(config.geoapifyKey) : createDemoGeo();
  root.render(
    <StrictMode>
      <App services={{ config, api, geo }} />
    </StrictMode>,
  );
}

export type DataMode = 'demo' | 'live';
/** osm = free keyless OpenStreetMap services (default for live). geoapify = optional keyed provider. demo = offline sample geography. */
export type GeoProviderName = 'osm' | 'geoapify' | 'demo';

export interface AppConfig {
  mode: DataMode;
  /** Set when live mode was requested but is not fully configured. The app shows an error, never demo data. */
  configError: string | null;
  supabaseUrl: string;
  supabaseKey: string;
  turnstileSiteKey: string;
  geoapifyKey: string;
  geoProvider: GeoProviderName;
  mapStyleUrl: string;
  recolorMap: boolean;
  defaultCenter: { lat: number; lng: number };
  defaultZoom: number;
}

export type Env = Record<string, string | boolean | undefined>;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function resolveConfig(env: Env): AppConfig {
  const requested = str(env.VITE_DATA_MODE).toLowerCase();
  const supabaseUrl = str(env.VITE_SUPABASE_URL);
  const supabaseKey = str(env.VITE_SUPABASE_PUBLISHABLE_KEY);
  const turnstileSiteKey = str(env.VITE_TURNSTILE_SITE_KEY);
  const geoapifyKey = str(env.VITE_GEOAPIFY_KEY);

  let mode: DataMode;
  if (requested === 'demo') mode = 'demo';
  else if (requested === 'live') mode = 'live';
  else mode = supabaseUrl && supabaseKey ? 'live' : 'demo';

  let configError: string | null = null;
  if (mode === 'live') {
    const missing = [
      !supabaseUrl && 'VITE_SUPABASE_URL',
      !supabaseKey && 'VITE_SUPABASE_PUBLISHABLE_KEY',
      !turnstileSiteKey && 'VITE_TURNSTILE_SITE_KEY',
    ].filter(Boolean);
    if (missing.length) configError = `Live mode is missing configuration: ${missing.join(', ')}.`;
    else if (!/^https:\/\//.test(supabaseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(supabaseUrl)) {
      configError = 'VITE_SUPABASE_URL must be an https:// URL.';
    }
    // A secret key in the browser bundle would bypass all database protections.
    if (/^sb_secret_/.test(supabaseKey) || /service_role/.test(decodeJwtRole(supabaseKey))) {
      configError = 'VITE_SUPABASE_PUBLISHABLE_KEY looks like a secret/service key. Never ship that to the browser.';
    }
  }

  const requestedGeo = str(env.VITE_GEO_PROVIDER).toLowerCase();
  const geoProvider: GeoProviderName =
    requestedGeo === 'osm' || requestedGeo === 'geoapify' || requestedGeo === 'demo'
      ? requestedGeo
      : mode === 'live' ? 'osm' : 'demo';
  if (mode === 'live' && geoProvider === 'demo') configError ??= 'VITE_GEO_PROVIDER=demo cannot be used in live mode.';
  if (geoProvider === 'geoapify' && !geoapifyKey) configError ??= 'VITE_GEO_PROVIDER=geoapify needs VITE_GEOAPIFY_KEY.';

  const center = str(env.VITE_DEFAULT_CENTER).split(',').map(Number);
  const hasCenter = center.length === 2 && center.every(Number.isFinite);

  return {
    mode,
    configError,
    supabaseUrl: supabaseUrl.replace(/\/$/, ''),
    supabaseKey,
    turnstileSiteKey,
    geoapifyKey,
    geoProvider,
    mapStyleUrl: str(env.VITE_MAP_STYLE_URL) || 'https://tiles.openfreemap.org/styles/positron',
    recolorMap: str(env.VITE_MAP_RECOLOR) !== 'false',
    defaultCenter: hasCenter
      ? { lat: center[0], lng: center[1] }
      : mode === 'demo' ? { lat: 31.55, lng: -97.15 } : { lat: 39.5, lng: -98.35 },
    defaultZoom: Number(env.VITE_DEFAULT_ZOOM) || (mode === 'demo' ? 8 : 3.6),
  };
}

function decodeJwtRole(key: string): string {
  if (!key.startsWith('eyJ')) return '';
  try {
    const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return String(JSON.parse(atob(payload)).role ?? '');
  } catch {
    return '';
  }
}

export const config: AppConfig = resolveConfig(import.meta.env as unknown as Env);

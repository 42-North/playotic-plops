import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Content-Security-Policy for production builds, limited to the services the app uses.
 * GitHub Pages cannot set headers, so it is delivered as a <meta> tag.
 */
function csp(env: Record<string, string>): Plugin {
  const origin = (u?: string) => {
    try { return u ? new URL(u).origin : ''; } catch { return ''; }
  };
  const supabase = origin(env.VITE_SUPABASE_URL);
  const tiles = origin(env.VITE_MAP_STYLE_URL) || 'https://tiles.openfreemap.org';
  const policy = [
    "default-src 'self'",
    "script-src 'self' https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${tiles}`,
    "font-src 'self'",
    `connect-src 'self' ${[supabase, tiles, 'https://nominatim.openstreetmap.org', 'https://routing.openstreetmap.de', env.VITE_GEO_PROVIDER === 'geoapify' ? 'https://api.geoapify.com' : ''].filter(Boolean).join(' ')}`,
    'frame-src https://challenges.cloudflare.com',
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'plops-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    // Relative asset paths work under any GitHub Pages repository subpath (with hash routing).
    base: env.BASE_PATH || './',
    plugins: [react(), csp(env)],
    build: { target: 'es2020', sourcemap: false, chunkSizeWarningLimit: 1200 },
    test: {
      environment: 'jsdom',
      include: ['tests/unit/**/*.test.{ts,tsx}'],
      setupFiles: ['tests/unit/setup.ts'],
      css: false,
    },
  };
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const THEME_BOOTSTRAP = `(function(){try{var c=document.cookie.split(';').map(function(s){return s.trim()}).filter(function(s){return s.indexOf('mcm_theme=')===0})[0];var t=c?c.split('=')[1]:null;if(!t){try{t=window.localStorage.getItem('mcm-theme')}catch(e){}}var d=t==='dark'||((!t||t==='system')&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',!!d);}catch(e){}})();`;

export default defineConfig({
  define: { __MCM_BUILD_COMMIT__: JSON.stringify(buildCommit()) },
  plugins: [themeBootstrapPlugin(), tanstackRouter({ target: 'react' }), react(), tailwindcss()],
});

// Container builds receive the same revision as the Go binary; local builds
// can read it from the checkout. Never infer a cached bundle's revision at runtime.
function buildCommit() {
  if (process.env.MCM_BUILD_COMMIT?.trim()) return process.env.MCM_BUILD_COMMIT.trim();
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

// Inject the theme bootstrap script into the built HTML <head>.
export function themeBootstrapPlugin() {
  return {
    name: 'mcm-theme-bootstrap',
    transformIndexHtml: {
      order: 'pre' as const,
      handler: () => [
        {
          tag: 'script',
          attrs: { type: 'text/javascript' },
          children: THEME_BOOTSTRAP,
          injectTo: 'head' as const,
        },
      ],
    },
  };
}

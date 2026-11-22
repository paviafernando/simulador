import { defineConfig } from 'vite';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (d, base = d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p, base) : ['/' + p.slice(base.length + 1).split('\\').join('/')]; });

// Genera precache.json con los archivos del bundle para que el service worker
// los guarde al instalarse y el simulador funcione sin internet.
const precache = () => ({
  name: 'pf-precache',
  generateBundle(_, bundle) {
    const files = Object.keys(bundle).filter((f) => /\.(js|css|wasm|json)$/.test(f) && f !== 'precache.json').map((f) => '/' + f);
    // Texturas, modelos y demás recursos de /public (se bajan después, sin frenar la instalación)
    const extras = walk('public').filter((f) => /^\/(assets|atmosphere|clouds|core|draco)\//.test(f));
    this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify({ v: Date.now(), files, extras }) });
  },
});

export default defineConfig({ plugins: [precache()] });

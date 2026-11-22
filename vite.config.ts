import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GAME_NAME } from './config/game.config.ts';

// Fingerprint of the runtime data so browsers fetch fresh files after puzzles or content change.
function dataVersion(): string {
  const h = createHash('sha1');
  for (const f of ['world.topo.json', 'countries.json', 'puzzles.json']) {
    const p = path.resolve(import.meta.dirname, 'public/data', f);
    if (fs.existsSync(p)) h.update(fs.readFileSync(p));
  }
  return h.digest('hex').slice(0, 10);
}

export default defineConfig({
  base: './',
  build: { rollupOptions: { input: { main: path.resolve(import.meta.dirname, 'index.html'), admin: path.resolve(import.meta.dirname, 'admin.html') } } },
  define: { __DATA_VERSION__: JSON.stringify(dataVersion()) },
  plugins: [{ name: 'game-name', transformIndexHtml: (html) => html.replaceAll('%GAME_NAME%', GAME_NAME) }],
});

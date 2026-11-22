import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export default defineConfig({
  base: './',
  publicDir: 'public-build',
  appType: 'spa',
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
  plugins: [{
    name: 'rattil-offline-shell', enforce: 'post',
    generateBundle(_, bundle) {
      const assets = Object.keys(bundle).filter(file => /\.(js|css|svg)$/.test(file)).map(file => './' + file);
      const id = createHash('sha256').update(JSON.stringify(assets)).digest('hex').slice(0, 12);
      for(const entry of Object.values(bundle))if(entry.type==='asset'&&entry.fileName.endsWith('.html'))entry.source=String(entry.source).replace('__APP_BUILD_ID__',id);
      this.emitFile({ type: 'asset', fileName: 'service-worker.js', source: readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8').replace('__BUILD_ID__', id).replace('__BUILD_ASSETS__', JSON.stringify(assets)) });
    },
  }],
});

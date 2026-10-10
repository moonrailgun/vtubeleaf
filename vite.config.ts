import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { rm } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      // MediaPipe loads the non-SIMD fallback only without WebAssembly SIMD, which WKWebView
      // (macOS 14+) and WebView2 always have; keep the 10 MB pair for Linux WebKitGTK only.
      name: 'omit-mediapipe-nosimd',
      apply: 'build',
      async writeBundle({ dir }) {
        if (!['darwin', 'win32'].includes(process.platform)) return;
        for (const extension of ['js', 'wasm'])
          await rm(`${dir}/runtime/mediapipe/wasm/vision_wasm_nosimd_internal.${extension}`, {
            force: true,
          });
      },
    },
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  clearScreen: false,
  server: { port: 21420, strictPort: true },
  build: { target: ['es2022', 'safari15'], chunkSizeWarningLimit: 1200 },
});

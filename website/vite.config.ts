import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createServer, defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { parseRelease } from './src/release';

export default defineConfig(async ({ isPreview }): Promise<UserConfig> => {
  if (isPreview) return {};

  const release = parseRelease(
    JSON.parse(await readFile(new URL('./public/release.json', import.meta.url), 'utf8')),
  );
  const define = { __RELEASE__: JSON.stringify(release) };
  let root: string;
  let outDir: string;

  return {
    define,
    plugins: [
      react(),
      {
        name: 'prerender-home',
        apply: 'build',
        configResolved(config) {
          root = config.root;
          outDir = resolve(root, config.build.outDir);
        },
        async writeBundle() {
          const server = await createServer({
            root,
            configFile: false,
            plugins: [react()],
            define,
            server: { middlewareMode: true, watch: null },
            appType: 'custom',
          });
          try {
            const { default: App } = await server.ssrLoadModule('/src/App.tsx');
            const file = resolve(outDir, 'index.html');
            const template = await readFile(file, 'utf8');
            if (!template.includes('<div id="root"></div>'))
              throw new Error('Missing prerender root');
            const markup = renderToString(createElement(App));
            await writeFile(
              file,
              template.replace('<div id="root"></div>', () => `<div id="root">${markup}</div>`),
            );
          } finally {
            await server.close();
          }
        },
      },
    ],
  };
});

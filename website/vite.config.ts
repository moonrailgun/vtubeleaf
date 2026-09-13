import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createServer, defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(async ({ isPreview }): Promise<UserConfig> => {
  if (isPreview) return {};

  const response = await fetch(
    'https://api.github.com/repos/moonrailgun/vtubeleaf/releases/latest',
    {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok)
    throw new Error(`Cannot load the latest GitHub Release: HTTP ${response.status}`);
  const latest = await response.json();
  if (latest.draft || latest.prerelease || !/^v\d+\.\d+\.\d+$/.test(latest.tag_name)) {
    throw new Error('Expected a published stable GitHub Release');
  }
  const version = latest.tag_name.slice(1);
  const releaseUrl = `https://github.com/moonrailgun/vtubeleaf/releases/tag/v${version}`;
  function asset(name: string): string {
    const url = `https://github.com/moonrailgun/vtubeleaf/releases/download/v${version}/${name}`;
    if (
      !latest.assets?.some(
        (item: { name: string; state: string; size: number; browser_download_url: string }) =>
          item.name === name &&
          item.state === 'uploaded' &&
          item.size > 0 &&
          item.browser_download_url === url,
      )
    )
      throw new Error(`GitHub Release v${version} is missing ${name}`);
    return url;
  }
  const release = {
    version,
    url: releaseUrl,
    windows: asset(`VTubeLeaf_${version}_x64-setup.exe`),
    mac: asset(`VTubeLeaf-${version}-macos-universal.dmg`),
    macZip: asset(`VTubeLeaf-${version}-macos-universal.zip`),
  };
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

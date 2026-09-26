import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const releaseUrl =
  'https://raw.githubusercontent.com/moonrailgun/vtubeleaf/main/website/public/release.json';
const base = 'https://github.com/moonrailgun/vtubeleaf/releases';
const latestRelease = {
  version: '99.98.97',
  url: `${base}/tag/v99.98.97`,
  windows: `${base}/download/v99.98.97/VTubeLeaf_99.98.97_x64-setup.exe`,
  mac: `${base}/download/v99.98.97/VTubeLeaf-99.98.97-macos-universal.dmg`,
  openseeface: {
    'windows-x86_64': `${base}/download/v99.98.97/VTubeLeaf-OpenSeeFace-99.98.97-windows-x64.zip`,
    'darwin-aarch64': `${base}/download/v99.98.97/VTubeLeaf-OpenSeeFace-99.98.97-macos-aarch64.dmg`,
    'darwin-x86_64': `${base}/download/v99.98.97/VTubeLeaf-OpenSeeFace-99.98.97-macos-x86_64.dmg`,
  },
};

const bootstrap = `import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      window.isTauri = true; mockWindows('main');
      window.trackerCalls = [];
      window.downloadCalls = [];
      mockIPC((cmd, args) => {
        if (cmd === 'load_settings') return { engine: 'openseeface', autoCheckUpdates: false };
        if (cmd === 'list_models') return { models: [], directory: '/test/models', errors: [] };
        if (cmd === 'get_download_platform') return window.downloadPlatform ?? 'darwin-aarch64';
        if (cmd === 'start_openseeface' || cmd === 'stop_openseeface') window.trackerCalls.push({ cmd, args });
        if (cmd === 'open_release_url') {
          if (window.downloadError) throw new Error('Browser unavailable');
          window.downloadCalls.push(args.url);
        }
      }, { shouldMockEvents: true });\n`;

test.beforeEach(async ({ page }) => {
  await page.route(releaseUrl, (route) => route.fulfill({ json: latestRelease }));
  await page.route('**/src/main.tsx*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: bootstrap + (await response.text()) });
  });
});

test('OpenSeeFace receives independently by default and keeps custom Python in advanced settings', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '面捕', exact: true }).click();
  await expect(page.locator('#pythonPath')).toHaveCount(0);
  await page.locator('#start').click();
  await expect(page.locator('#tracking-status')).toHaveText('正在跟踪');
  expect(await page.evaluate(() => (window as any).trackerCalls.at(-1))).toMatchObject({
    cmd: 'start_openseeface',
    args: { mode: 'external', camera: 0, port: 11573 },
  });
  await page.locator('#start').click();
  await expect(page.locator('#tracking-status')).toHaveText('尚未开始');
  expect(await page.evaluate(() => (window as any).trackerCalls.at(-1).cmd)).toBe(
    'stop_openseeface',
  );
  await page.locator('#osf-options summary').click();
  await page.locator('#openseeface-mode').click();
  await page.getByRole('option', { name: '自定义 Python', exact: true }).click();
  await page.locator('#pythonPath').fill('/python');
  await page.locator('#scriptPath').fill('/tracker.py');
  await expect(page.locator('#camera')).toBeEnabled();
  await page.locator('#start').click();
  await expect(page.locator('#tracking-status')).toHaveText('正在跟踪');
  expect(await page.evaluate(() => (window as any).trackerCalls.at(-1))).toMatchObject({
    cmd: 'start_openseeface',
    args: { mode: 'custom', pythonPath: '/python', scriptPath: '/tracker.py' },
  });
});

for (const [label, platform] of [
  ['Windows x64', 'windows-x86_64'],
  ['macOS Apple Silicon', 'darwin-aarch64'],
  ['macOS Intel', 'darwin-x86_64'],
] as const) {
  test(`OpenSeeFace offers a direct ${label} download and a secondary download-page button`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      (window as any).downloadPlatform = value;
    }, platform);
    await page.goto('/');
    await page.getByRole('button', { name: '面捕', exact: true }).click();
    const download = page.getByRole('button', { name: `下载 ${label} 版`, exact: true });
    const downloadPage = page.getByRole('button', { name: '去到下载页', exact: true });
    await expect(download).toBeVisible();
    await expect(downloadPage).toBeVisible();
    await download.click();
    await expect
      .poll(() => page.evaluate(() => (window as any).downloadCalls.at(-1)))
      .toBe(latestRelease.openseeface[platform]);
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.locator('#osf-options')).not.toContainText(
      '上半身识别与关键点预览请使用 MediaPipe。',
    );
    expect(await page.evaluate(() => (window as any).trackerCalls)).toEqual([]);
    await downloadPage.click();
    await expect
      .poll(() => page.evaluate(() => (window as any).downloadCalls.at(-1)))
      .toBe(`${base}/latest`);

    const newerRelease = JSON.parse(
      JSON.stringify(latestRelease).replaceAll('99.98.97', '99.98.98'),
    );
    await page.route(releaseUrl, (route) => route.fulfill({ json: newerRelease }));
    await download.click();
    await expect
      .poll(() => page.evaluate(() => (window as any).downloadCalls.at(-1)))
      .toBe(newerRelease.openseeface[platform]);
    await page.evaluate(() => {
      (window as any).downloadError = true;
    });
    await download.click();
    await expect(page.locator('#osf-options [role="status"]')).toContainText('无法打开下载链接');
  });
}

test('OpenSeeFace downloads keep a release-page fallback and can recover after fetch failure', async ({
  page,
}) => {
  for (const response of [
    { status: 503, json: {} },
    { json: { ...latestRelease, openseeface: undefined } },
    {
      json: {
        ...latestRelease,
        openseeface: {
          ...latestRelease.openseeface,
          'windows-x86_64': 'https://example.com/download',
        },
      },
    },
  ]) {
    await page.route(releaseUrl, (route) => route.fulfill(response));
    await page.goto('/');
    await page.getByRole('button', { name: '面捕', exact: true }).click();
    await page.getByRole('button', { name: '下载 macOS Apple Silicon 版' }).click();
    await expect(page.locator('#osf-options [role="status"]')).toContainText(
      '暂时无法获取下载信息',
    );
    expect(await page.evaluate(() => (window as any).downloadCalls)).toEqual([]);
    await page.getByRole('button', { name: '去到下载页', exact: true }).click();
    expect(await page.evaluate(() => (window as any).downloadCalls.at(-1))).toBe(`${base}/latest`);
  }
  await page.route(releaseUrl, (route) => route.fulfill({ json: latestRelease }));
  await page.getByRole('button', { name: '下载 macOS Apple Silicon 版' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).downloadCalls.at(-1)))
    .toBe(latestRelease.openseeface['darwin-aarch64']);
});

test('OpenSeeFace keeps the download page available on an unsupported architecture', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).downloadPlatform = 'linux-x86_64';
  });
  await page.goto('/');
  await page.getByRole('button', { name: '面捕', exact: true }).click();
  await expect(page.getByRole('button', { name: '下载当前架构版本' })).toBeDisabled();
  await page.getByRole('button', { name: '去到下载页', exact: true }).click();
  expect(await page.evaluate(() => (window as any).downloadCalls)).toEqual([`${base}/latest`]);
});

test('OpenSeeFace downloads load under the production desktop security policy', async ({
  page,
}, testInfo) => {
  const csp = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')).app.security.csp;
  const html = readFileSync('dist/index.html', 'utf8');
  const entry = html.match(/<script[^>]+src="([^"]+)"/)![1];
  await page.route('**/assets/*', (route) => {
    const path = new URL(route.request().url()).pathname;
    const file = resolve('dist/assets', basename(path));
    return route.fulfill(
      path === entry
        ? { body: bootstrap + readFileSync(file, 'utf8'), contentType: 'text/javascript' }
        : { path: file },
    );
  });
  await page.route('**/download-preview', (route) =>
    route.fulfill({
      body: html,
      contentType: 'text/html',
      headers: { 'content-security-policy': csp },
    }),
  );
  await page.goto('/download-preview');
  await page.getByRole('button', { name: '面捕', exact: true }).click();
  await page.getByRole('button', { name: '下载 macOS Apple Silicon 版' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).downloadCalls.at(-1)))
    .toBe(latestRelease.openseeface['darwin-aarch64']);
  await expect(page.getByRole('button', { name: '去到下载页', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('openseeface-download.png') });
});

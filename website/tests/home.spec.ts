import { expect, test } from '@playwright/test';

const latestReleaseApi =
  'https://raw.githubusercontent.com/moonrailgun/vtubeleaf/main/website/public/release.json';
const latestRelease = {
  version: '99.98.97',
  url: 'https://github.com/moonrailgun/vtubeleaf/releases/tag/v99.98.97',
  windows:
    'https://github.com/moonrailgun/vtubeleaf/releases/download/v99.98.97/VTubeLeaf_99.98.97_x64-setup.exe',
  mac: 'https://github.com/moonrailgun/vtubeleaf/releases/download/v99.98.97/VTubeLeaf-99.98.97-macos-universal.dmg',
};

test.beforeEach(async ({ page }) => {
  await page.route(latestReleaseApi, (route) => route.fulfill({ json: latestRelease }));
});

test('Linux downloads require published assets and tabs cycle through all platforms', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'platform', { value: 'Linux x86_64' }),
  );
  await page.goto('/');
  const linux = page.getByRole('tab', { name: 'Linux' });
  await expect(linux).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toContainText('尚未发布 Linux 安装包');
  await expect(page.getByRole('link', { name: '下载 Linux AppImage' })).toHaveCount(0);

  const downloads = {
    appimage:
      'https://github.com/moonrailgun/vtubeleaf/releases/download/v99.98.97/VTubeLeaf_99.98.97_amd64.AppImage',
    deb: 'https://github.com/moonrailgun/vtubeleaf/releases/download/v99.98.97/VTubeLeaf_99.98.97_amd64.deb',
  };
  await page.route(latestReleaseApi, (route) =>
    route.fulfill({ json: { ...latestRelease, linux: downloads } }),
  );
  await page.reload();
  await expect(page.getByRole('link', { name: '下载 Linux AppImage' })).toHaveAttribute(
    'href',
    downloads.appimage,
  );
  await expect(page.getByRole('link', { name: '下载 Linux .deb' })).toHaveAttribute(
    'href',
    downloads.deb,
  );
  await expect(page.locator('.download-actions a').first()).toHaveText('下载 Linux AppImage');
  await expect(page.getByRole('tabpanel')).toContainText('v4l2loopback');
  await linux.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Windows' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(linux).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('End');
  await expect(linux).toBeFocused();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('downloads and version refresh to the latest release without rebuilding', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto('/');
  expect(await response!.text()).not.toContain('99.98.97');
  await expect(page.locator('.hero-note')).toContainText('99.98.97');
  await expect(page.locator('#install')).toContainText('最新稳定版 v99.98.97');
  await expect(page.locator('footer')).toContainText('版本 99.98.97');
  for (const [platform, name, asset] of [
    ['Windows', '下载 Windows 版', latestRelease.windows],
    ['macOS', '下载 macOS 版', latestRelease.mac],
  ] as const) {
    await page.getByRole('tab', { name: platform }).click();
    await expect(page.getByRole('link', { name })).toHaveAttribute('href', asset);
  }
  await expect(page.getByRole('link', { name: 'macOS ZIP 下载' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '更新说明与全部安装包' })).toHaveAttribute(
    'href',
    'https://github.com/moonrailgun/vtubeleaf/releases/tag/v99.98.97',
  );
  const schema = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent()) || '',
  );
  expect(schema.softwareVersion).toBe('99.98.97');
  expect(schema.downloadUrl).toEqual([latestRelease.windows, latestRelease.mac]);
  expect(errors).toEqual([]);
});

test('unavailable or incomplete releases retain the build-time downloads', async ({ page }) => {
  for (const response of [
    { status: 503, json: { message: 'Unavailable' } },
    { json: { ...latestRelease, mac: null } },
    { json: { ...latestRelease, version: '99.98.97-beta.1' } },
    { json: { ...latestRelease, windows: 'https://example.com/download' } },
  ]) {
    await page.route(latestReleaseApi, (route) => route.fulfill(response));
    const refreshed = page.waitForResponse(latestReleaseApi);
    const document = await page.goto('/');
    const html = await document!.text();
    const schema = JSON.parse(
      html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1],
    );
    await (await refreshed).finished();
    await page.getByRole('tab', { name: 'Windows' }).click();
    await expect(page.getByRole('tab', { name: 'Windows' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('.hero-note')).toContainText(schema.softwareVersion);
    await expect(page.getByRole('link', { name: '下载 Windows 版' })).toHaveAttribute(
      'href',
      schema.downloadUrl[0],
    );
    await page.getByRole('tab', { name: 'macOS' }).click();
    await expect(page.getByRole('link', { name: '下载 macOS 版' })).toHaveAttribute(
      'href',
      schema.downloadUrl[1],
    );
  }
});

test('homepage keeps the design and its keyboard-accessible interactions', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('替你出镜');
  const downloads = page.getByRole('link', { name: '免费下载', exact: true });
  await expect(downloads).toHaveCount(3);
  for (const link of await downloads.all()) await expect(link).toHaveAttribute('href', '#install');
  await downloads.first().click();
  await expect(page).toHaveURL(/#install$/);
  const windows = page.getByRole('tab', { name: 'Windows' });
  const mac = page.getByRole('tab', { name: 'macOS' });
  await windows.click();
  await expect(page.getByRole('link', { name: '下载 Windows 版' })).toHaveAttribute(
    'href',
    /^https:\/\/github\.com\/moonrailgun\/vtubeleaf\/releases\/download\/v[\d.]+\/VTubeLeaf_[\d.]+_x64-setup\.exe$/,
  );
  await page.keyboard.press('ArrowRight');
  await expect(mac).toBeFocused();
  await expect(mac).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('link', { name: '下载 macOS 版' })).toHaveAttribute(
    'href',
    /^https:\/\/github\.com\/moonrailgun\/vtubeleaf\/releases\/download\/v[\d.]+\/VTubeLeaf-[\d.]+-macos-universal\.dmg$/,
  );
  await expect(page.getByRole('tabpanel')).toContainText('macOS 14');
  await page.reload();
  await expect(mac).toHaveAttribute('aria-selected', 'true');
  await mac.focus();
  await page.keyboard.press('Home');
  await expect(windows).toBeFocused();
  await expect(windows).toHaveAttribute('aria-selected', 'true');

  const faq = page.locator('.faq details');
  await faq.nth(1).locator('summary').click();
  await expect(faq.nth(1)).toHaveAttribute('open', '');
  await expect(faq.first()).not.toHaveAttribute('open');
  await page.keyboard.press('Enter');
  await expect(faq.nth(1)).not.toHaveAttribute('open');
  expect(errors).toEqual([]);
});

test('small screens, anchors and local assets remain usable without storage', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Storage disabled', 'SecurityError');
      },
    });
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: '跳到正文' })).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await page.getByRole('tab', { name: 'Windows' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Windows 10');
  // The footer logo loads lazily, so bring it into view before checking every image.
  await page.locator('.cta img').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.images].every((image) => image.complete));
  const layout = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    brokenImages: [...document.images].filter((image) => !image.complete || !image.naturalWidth)
      .length,
    missingAnchors: [...document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')].filter(
      (link) => link.hash && !document.getElementById(link.hash.slice(1)),
    ).length,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
  expect(layout.brokenImages).toBe(0);
  expect(layout.missingAnchors).toBe(0);
  const comparison = page.locator('.cmp-wrap');
  expect(await comparison.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
    true,
  );
});

test('the built response contains indexable content and crawl metadata', async ({ request }) => {
  const response = await request.get('/');
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain('<main');
  expect(html).toContain('替你出镜');
  expect(html).toContain('面部跟随');
  expect(html).toContain('releases/download/');
  expect(html).toContain('rel="canonical" href="https://vtubeleaf.vercel.app/"');
  expect(html).not.toContain('noindex');
  expect(html).not.toContain('macOS ZIP 下载');
  // The WebP hero is the LCP image: preload it first and keep the footer logo out of the way.
  expect(html).toContain(
    '<link rel="preload" as="image" href="assets/screenshots/vtubeleaf-hutao-studio.webp" fetchPriority="high"/>',
  );
  expect(html).not.toContain(
    '<link rel="preload" as="image" href="assets/brand/lockup-rose-dark.svg"',
  );
  expect((await request.get('/assets/screenshots/vtubeleaf-hutao-studio.png')).status()).toBe(200);
  const manifest = await request.get('/release.json');
  expect(manifest.status()).toBe(200);
  const release = await manifest.json();
  const schema = JSON.parse(
    html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1],
  );
  expect(schema['@type']).toBe('SoftwareApplication');
  expect(schema.name).toBe('VTubeLeaf');
  expect(schema.softwareVersion).toMatch(/^\d+\.\d+\.\d+$/);
  expect(schema.softwareVersion).toBe(release.version);
  expect(schema.downloadUrl).toEqual([
    release.windows,
    release.mac,
    ...(release.linux ? [release.linux.appimage, release.linux.deb] : []),
  ]);
  expect(html).toContain(
    `v${schema.softwareVersion}/VTubeLeaf_${schema.softwareVersion}_x64-setup.exe`,
  );
  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain('Sitemap: https://vtubeleaf.vercel.app/sitemap.xml');
  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  expect(await sitemap.text()).toContain('<loc>https://vtubeleaf.vercel.app/</loc>');
});

test('hashed build assets are cached immutably while public files revalidate', async ({
  request,
}) => {
  const home = await request.get('/');
  test.skip(home.headers().server !== 'Vercel', 'Only the Vercel deployment applies vercel.json');
  const built = (await home.text()).match(/\/assets\/[^"/]+\.(?:js|css)/g);
  expect(built).not.toBeNull();
  const cacheControl = async (path: string) => (await request.get(path)).headers()['cache-control'];
  for (const path of built!)
    expect(await cacheControl(path)).toBe('public, max-age=31536000, immutable');
  for (const path of ['/', '/assets/screenshots/vtubeleaf-hutao-studio.webp'])
    expect(await cacheControl(path)).not.toContain('immutable');
});

test('content, default download and all-packages link work without JavaScript', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    await page.goto(process.env.WEBSITE_URL || 'http://127.0.0.1:5198');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('替你出镜');
    await page.getByRole('link', { name: '免费下载', exact: true }).first().click();
    await expect(page.getByRole('link', { name: '下载 Windows 版' })).toBeVisible();
    await expect(page.getByRole('link', { name: '更新说明与全部安装包' })).toHaveAttribute(
      'href',
      /^https:\/\/github\.com\/moonrailgun\/vtubeleaf\/releases\/tag\/v[\d.]+$/,
    );
    await page.locator('.faq summary').nth(1).click();
    await expect(page.locator('.faq details').nth(1)).toHaveAttribute('open', '');
  } finally {
    await context.close();
  }
});

for (const [system, preferred, other] of [
  ['MacIntel', 'macOS', 'Windows'],
  ['Win32', 'Windows', 'macOS'],
] as const)
  test(`${preferred} downloads follow the selected platform without other-system links`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.addInitScript(
      (value) => Object.defineProperty(navigator, 'platform', { value }),
      system,
    );
    await page.goto('/');
    await expect(page.getByRole('tab', { name: preferred })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const buttons = page.locator('.download-actions a');
    await expect(buttons).toHaveText([`下载 ${preferred} 版`]);
    await expect(buttons.first()).toHaveClass('btn btn-primary');
    await page.getByRole('tab', { name: other }).click();
    await expect(buttons).toHaveText([`下载 ${other} 版`]);
    await expect(buttons.first()).toHaveClass('btn btn-primary');
    await page.reload();
    await expect(page.getByRole('tab', { name: other })).toHaveAttribute('aria-selected', 'true');
    await expect(buttons).toHaveText([`下载 ${other} 版`]);
    expect(errors).toEqual([]);
  });

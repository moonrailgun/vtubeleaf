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

test('downloads and version refresh to the latest release without rebuilding', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto('/');
  expect(await response!.text()).not.toContain('99.98.97');
  await expect(page.locator('.hero-note')).toContainText('99.98.97');
  await expect(page.locator('#install')).toContainText('最新稳定版 v99.98.97');
  await expect(page.locator('footer')).toContainText('版本 99.98.97');
  for (const [name, asset] of [
    ['下载 Windows 版', latestRelease.windows],
    ['下载 macOS 版', latestRelease.mac],
  ] as const) {
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
  await expect(page.getByRole('link', { name: '下载 Windows 版' })).toHaveAttribute(
    'href',
    /^https:\/\/github\.com\/moonrailgun\/vtubeleaf\/releases\/download\/v[\d.]+\/VTubeLeaf_[\d.]+_x64-setup\.exe$/,
  );
  await expect(page.getByRole('link', { name: '下载 macOS 版' })).toHaveAttribute(
    'href',
    /^https:\/\/github\.com\/moonrailgun\/vtubeleaf\/releases\/download\/v[\d.]+\/VTubeLeaf-[\d.]+-macos-universal\.dmg$/,
  );

  await page.getByRole('button', { name: /会议专用/ }).click();
  await expect(page.locator('#avatarCap')).toContainText('会议专用');
  const blink = page.getByRole('switch', { name: '跟着我眨眼' });
  await blink.focus();
  await page.keyboard.press('Space');
  await expect(blink).not.toBeChecked();
  const amplitude = page.getByRole('slider', { name: '动作幅度' });
  await amplitude.fill('35');
  await expect(page.locator('#ampVal')).toHaveText('35%');
  await page.getByRole('slider', { name: '反应速度' }).fill('0');
  await expect(page.locator('#spdVal')).toHaveText('慢');

  const windows = page.getByRole('tab', { name: 'Windows' });
  const mac = page.getByRole('tab', { name: 'macOS' });
  await windows.click();
  await page.keyboard.press('ArrowRight');
  await expect(mac).toBeFocused();
  await expect(mac).toHaveAttribute('aria-selected', 'true');
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
  expect(schema.downloadUrl).toEqual([release.windows, release.mac]);
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

test('content and both platform downloads work without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    await page.goto(process.env.WEBSITE_URL || 'http://127.0.0.1:5198');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('替你出镜');
    await page.getByRole('link', { name: '免费下载', exact: true }).first().click();
    await expect(page.getByRole('link', { name: '下载 Windows 版' })).toBeVisible();
    await expect(page.getByRole('link', { name: '下载 macOS 版' })).toBeVisible();
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
  test(`${preferred} downloads are first and highlighted, following the selected platform`, async ({
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
    await expect(buttons).toHaveText([`下载 ${preferred} 版`, `下载 ${other} 版`]);
    await expect(buttons.first()).toHaveClass('btn btn-primary');
    await expect(buttons.last()).toHaveClass('btn btn-ghost');
    await page.getByRole('tab', { name: other }).click();
    await expect(buttons).toHaveText([`下载 ${other} 版`, `下载 ${preferred} 版`]);
    await expect(buttons.first()).toHaveClass('btn btn-primary');
    await page.reload();
    await expect(page.getByRole('tab', { name: other })).toHaveAttribute('aria-selected', 'true');
    await expect(buttons).toHaveText([`下载 ${other} 版`, `下载 ${preferred} 版`]);
    expect(errors).toEqual([]);
  });

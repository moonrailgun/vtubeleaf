import { expect, test } from '@playwright/test';

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
  const schema = JSON.parse(
    html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1],
  );
  expect(schema['@type']).toBe('SoftwareApplication');
  expect(schema.name).toBe('VTubeLeaf');
  expect(schema.softwareVersion).toMatch(/^\d+\.\d+\.\d+$/);
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

test('macOS detection hydrates without losing the selected platform', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel' }),
  );
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'macOS' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Windows' }).click();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Windows' })).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});

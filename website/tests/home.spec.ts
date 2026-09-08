import { expect, test } from '@playwright/test';

test('homepage keeps the design and its keyboard-accessible interactions', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('替你出镜');
  const downloads = page.getByRole('button', { name: '待发布', exact: true });
  await expect(downloads).toHaveCount(3);
  for (const button of await downloads.all()) await expect(button).toBeDisabled();
  await expect(page.locator('a[href*="/releases"]')).toHaveCount(0);

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

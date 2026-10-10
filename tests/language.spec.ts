import { test, expect } from '@playwright/test';
import { openFold } from './panel';

test('a chosen UI language applies after restarting and can return to the system language', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '接入', exact: true }).click();
  await openFold(page, '画质与通用设置');
  const language = page.getByRole('combobox', { name: '界面语言', exact: true });
  await expect(language).toHaveText('跟随系统');
  await expect(page.getByRole('button', { name: '立即重启', exact: true })).toHaveCount(0);
  await language.click();
  await page.getByRole('option', { name: 'English', exact: true }).click();
  await expect(page.getByText('重启应用后生效', { exact: true })).toBeVisible();

  // The browser preview restarts by reloading.
  await page.getByRole('button', { name: '立即重启', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Library', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await openFold(page, 'Quality and general');
  const english = page.getByRole('combobox', { name: 'Language', exact: true });
  await expect(english).toHaveText('English');
  await english.click();
  await page.getByRole('option', { name: 'Match system', exact: true }).click();
  await page.getByRole('button', { name: 'Restart now', exact: true }).click();
  await expect(page.getByRole('button', { name: '角色库', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh');
});

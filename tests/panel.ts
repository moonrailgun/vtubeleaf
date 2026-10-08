import type { Page } from '@playwright/test';

// Settings folds start collapsed; open one on the visible panel unless it is already open.
export async function openFold(page: Page, title: string) {
  const fold = page
    .locator('#controls .panel:not([hidden])')
    .getByRole('button', { name: title, exact: true });
  if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
}

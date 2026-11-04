import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS } from './users';

/* Phone-sized screens: the site and admin menus fold behind a Menu button. */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

// Runs in the browser; a string keeps the test file free of DOM types.
const pageIsNoWiderThanScreen = (page: Page) =>
  page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth');

test('the public menu opens, navigates and closes on a phone', async ({ page }) => {
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Menu' });
  const main = page.getByRole('navigation', { name: 'Main' });
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(main).toBeHidden();

  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('searchbox', { name: 'Search CivicScope' })).toBeVisible();
  await main.getByRole('link', { name: 'Bills' }).click();

  await expect(page).toHaveURL(/\/bills$/);
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  expect(await pageIsNoWiderThanScreen(page)).toBe(true);

  await menu.click();
  await page.keyboard.press('Escape');
  await expect(main).toBeHidden();
});

test('the admin menu opens on a phone and pages fit the screen', async ({ page }) => {
  await page.goto('/admin/sign-in');
  await page.getByLabel('Email').fill(E2E_USERS.owner.email);
  await page.getByLabel('Password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  const menu = page.getByRole('button', { name: 'Menu' });
  const nav = page.getByRole('navigation', { name: 'Admin' });
  await expect(nav).toBeHidden();
  await menu.click();
  await nav.getByRole('link', { name: 'Elections & races' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Elections' })).toBeVisible();
  await expect(nav).toBeHidden();

  for (const path of ['/admin/elections', '/admin/elections/new', '/admin/candidates']) {
    await page.goto(path);
    expect(await pageIsNoWiderThanScreen(page), path).toBe(true);
  }
});

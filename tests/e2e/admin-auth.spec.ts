import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS } from './users';

/** The sign-in form's error (Next.js also renders an empty route-announcer alert). */
const formAlert = (page: Page) => page.locator('form').getByRole('alert');

async function signIn(page: Page, email: string, password = E2E_PASSWORD) {
  await page.goto('/admin/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('the admin area redirects to sign-in when nobody is signed in', async ({ page }) => {
  for (const path of ['/admin', '/admin/users']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/admin\/sign-in$/);
  }
});

test('admin pages are marked noindex and uncacheable', async ({ request }) => {
  const response = await request.get('/admin/sign-in');
  expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow');
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers()['x-frame-options']).toBe('DENY');
});

test('a wrong password shows a generic error and no session', async ({ page, context }) => {
  await signIn(page, E2E_USERS.owner.email, 'definitely the wrong password');
  await expect(formAlert(page)).toHaveText('Email or password is incorrect.');
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
  const cookies = await context.cookies();
  expect(cookies.some((c) => c.name.includes('cs_session'))).toBe(false);
});

test('the owner can sign in, see the users page, and sign out', async ({ page, context }) => {
  await signIn(page, E2E_USERS.owner.email);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText(E2E_USERS.owner.email)).toBeVisible();

  const [session] = (await context.cookies()).filter((c) => c.name.includes('cs_session'));
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe('Lax');

  await page.getByRole('link', { name: 'Users' }).click();
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  await expect(page.getByRole('cell', { name: E2E_USERS.viewer.email, exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
});

test('a signed-out session token no longer works', async ({ page, context, browser }) => {
  await signIn(page, E2E_USERS.owner.email);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  const stolen = (await context.cookies()).filter((c) => c.name.includes('cs_session'));

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/admin\/sign-in$/);

  // Replaying the old cookie in a fresh browser must not get in.
  const other = await browser.newContext();
  await other.addCookies(stolen);
  const otherPage = await other.newPage();
  await otherPage.goto('/admin');
  await expect(otherPage).toHaveURL(/\/admin\/sign-in$/);
  await other.close();
});

test('a viewer is refused owner-only pages on the server', async ({ page }) => {
  await signIn(page, E2E_USERS.viewer.email);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0);

  // Typing the URL directly is refused too: the check runs on the server.
  await page.goto('/admin/users');
  await expect(page).toHaveURL(/\/admin\/forbidden$/);
  await expect(page.getByRole('heading', { name: /don.t have access/ })).toBeVisible();
});

test('repeated failures lock the account for 15 minutes', async ({ page }) => {
  for (let i = 0; i < 5; i++) {
    await signIn(page, E2E_USERS.lockout.email, `wrong password number ${i}`);
    await expect(formAlert(page)).toHaveText('Email or password is incorrect.');
  }
  await signIn(page, E2E_USERS.lockout.email);
  await expect(formAlert(page)).toHaveText('Too many failed attempts. Try again in 15 minutes.');
});

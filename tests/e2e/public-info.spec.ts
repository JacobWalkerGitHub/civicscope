import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS } from './users';

/* Fixture data in a throwaway database, not real corrections or coverage. */

async function signIn(page: Page, email: string) {
  await page.goto('/admin/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function expectNoSeriousA11yIssues(page: Page) {
  // Next.js streams a page's generated <title> in after the content; wait for it first.
  await expect(page).toHaveTitle(/\S/);
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test.describe.configure({ mode: 'serial' });

test('methodology and about pages are linked from every public page', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'About CivicScope' })
    .getByRole('link', { name: 'How we work' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('How we work');
  await expect(page.getByText('No source, no publication')).toBeVisible();
  await expect(page.getByText('Tier 1 · official record')).toBeVisible();
  await expectNoSeriousA11yIssues(page);

  await page
    .getByRole('navigation', { name: 'About CivicScope' })
    .getByRole('link', { name: 'About' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('About CivicScope');
  await expectNoSeriousA11yIssues(page);
});

test('coverage starts empty and shows what an admin lists', async ({ page }) => {
  await page.goto('/coverage');
  await expect(page.getByText('No coverage is published yet.')).toBeVisible();

  await signIn(page, E2E_USERS.owner.email);
  await page.goto('/admin/coverage');
  await page.getByLabel('State').selectOption({ label: 'Kentucky' });
  await page.getByLabel('Election year').fill('2027');
  await page.getByLabel('Offices').selectOption({ label: 'State' });
  await page.getByRole('combobox', { name: 'Coverage' }).selectOption({ label: 'Complete' });
  await page.getByRole('button', { name: 'Save coverage' }).click();
  await expect(page.locator('p.alert')).toBeVisible();
  await expect(page.getByText('Say the date the coverage was complete as of.')).toBeVisible();

  await page.getByRole('combobox', { name: 'Coverage' }).selectOption({ label: 'Partial' });
  await page.getByLabel('Note').fill('E2E governor race only');
  await page.getByRole('button', { name: 'Save coverage' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  await expect(page.locator('tbody')).toContainText('E2E governor race only');

  await page.context().clearCookies();
  await page.goto('/coverage');
  await expect(page.getByRole('heading', { name: '2027 elections' })).toBeVisible();
  const row = page.getByRole('row', { name: /Kentucky/ });
  await expect(row).toContainText('Partial');
  await expect(row).toContainText('E2E governor race only');
  await expectNoSeriousA11yIssues(page);
});

test('a reader reports a mistake without an account', async ({ page }) => {
  await page.goto('/corrections?page=/candidates/e2e-example');
  await expect(page.getByLabel('Page with the error')).toHaveValue('/candidates/e2e-example');
  await expect(page.getByRole('heading', { name: 'Our correction policy' })).toBeVisible();
  await expect(page.getByText('Nobody can pay to change, add or remove anything.')).toBeVisible();
  await expectNoSeriousA11yIssues(page);

  await page.getByLabel('What is wrong?').fill('Too short');
  await page.getByRole('button', { name: 'Send correction' }).click();
  await expect(page.locator('p.alert')).toHaveText('Please fix the highlighted fields.');

  await page
    .getByLabel('What is wrong?')
    .fill('E2E: the filing date shown does not match the state list.');
  await page
    .getByLabel('A source that shows the right information')
    .fill('https://elections.example.gov/e2e/list');
  await page.getByLabel('Your email').fill('reader@example.com');
  await page.getByRole('button', { name: 'Send correction' }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Thank you. An editor will review your request.',
  );
  await expect(page.getByLabel('What is wrong?')).toHaveValue('');
  await expect(page.getByText('No corrections have been made yet.')).toBeVisible();
});

test('viewers cannot read correction requests, which can include emails', async ({ page }) => {
  await signIn(page, E2E_USERS.viewer.email);
  await expect(page.getByRole('link', { name: /Corrections/ })).toHaveCount(0);
  await page.goto('/admin/corrections');
  await expect(page).toHaveURL(/\/admin\/forbidden$/);
});

test('an editor can read requests, and a reviewer fixes one into the public log', async ({
  page,
}) => {
  await signIn(page, E2E_USERS.editor.email);
  await page.getByRole('link', { name: /Corrections/ }).click();
  await page
    .getByRole('row', { name: /filing date shown/ })
    .getByRole('link')
    .click();
  await expect(page.getByText('reader@example.com')).toBeVisible();
  await expect(page.getByText('A reviewer or owner decides')).toBeVisible();
  await page.context().clearCookies();

  await signIn(page, E2E_USERS.reviewer.email);
  await page.goto('/admin/corrections');
  await page
    .getByRole('row', { name: /filing date shown/ })
    .getByRole('link')
    .click();
  await page.getByLabel('State').selectOption({ label: 'Fixed' });
  await page.getByLabel('Internal note').fill('Checked the state list.');
  await page.getByLabel('Public corrections log').fill('E2E: corrected a candidate’s filing date.');
  await page.getByRole('button', { name: 'Save decision' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  await expect(page.locator('.badge')).toHaveText('Fixed');

  await page.goto('/admin/corrections?show=resolved');
  await expect(page.getByRole('row', { name: /filing date shown/ })).toBeVisible();

  await page.context().clearCookies();
  await page.goto('/corrections');
  const log = page.locator('.corrections-log');
  await expect(log).toContainText('E2E: corrected a candidate’s filing date.');
  await expect(log).not.toContainText('Checked the state list.');
  await expect(page.getByText('reader@example.com')).toHaveCount(0);
});

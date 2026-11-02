import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS } from './users';

/* Fixture data in a throwaway database: "E2E" names and example.* URLs, not real people. */

async function signIn(page: Page, email: string) {
  await page.goto('/admin/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function press(page: Page, name: string) {
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name, exact: true }).click();
}

async function expectNoSeriousA11yIssues(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test.describe.configure({ mode: 'serial' });

let raceId = '';
let electionUrl = '';
const NAME = 'Dana E2E Public';

test('drafts can be previewed by admins but are not public', async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email);
  await page.goto('/admin/offices/new');
  await page.getByLabel('Title').fill('E2E Public Treasurer');
  await page.getByLabel('Jurisdiction').selectOption({ label: 'Kentucky' });
  await page.getByLabel('Level').selectOption({ label: 'State' });
  await page.getByLabel('Branch').selectOption({ label: 'Executive' });
  await page.getByRole('button', { name: 'Create office' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Public Treasurer' })).toBeVisible();

  await page.goto('/admin/elections/new');
  await page.getByLabel('State').selectOption({ label: 'Kentucky' });
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('2027 E2E Public Election');
  await page.getByLabel('Type').selectOption({ label: 'General' });
  await page
    .getByLabel('Primary system')
    .selectOption({ label: 'Not applicable (general election)' });
  await page.getByLabel('Election date').fill('2027-11-16');
  await page.getByRole('button', { name: 'Create election' }).click();
  await expect(page.getByRole('heading', { name: '2027 E2E Public Election' })).toBeVisible();
  electionUrl = page.url().split('?')[0]!;

  await page.getByText('Add a race').click();
  await page.getByLabel('Office').selectOption({ label: 'E2E Public Treasurer (Kentucky)' });
  await page.getByLabel('Race name').fill('E2E Public Treasurer');
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Public Treasurer' })).toBeVisible();
  raceId = page.url().split('?')[0]!.split('/').pop()!;

  // Load one candidate through a CSV import, which cites the source for us.
  await page.getByRole('link', { name: 'Import candidates from a CSV file' }).click();
  await page.getByLabel('CSV file').setInputFiles({
    name: 'public.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`full_name,status,status_date\n${NAME},filed,2026-03-02\n`),
  });
  await page.getByLabel('Source URL').fill('https://elections.example.gov/e2e/public-list');
  await page.getByLabel('Source title').fill('E2E public candidate list');
  await page.getByLabel('Publisher').fill('E2E Board of Elections');
  await page.getByLabel('Source type').selectOption({ label: 'Official election authority' });
  await page.getByRole('button', { name: 'Upload and preview' }).click();
  await press(page, 'Apply import');
  await expect(page.getByRole('status')).toContainText('Applied');

  await page.goto(`/admin/races/${raceId}`);
  await page.getByRole('link', { name: 'Preview public page' }).click();
  await expect(page.getByRole('note')).toContainText('Preview.');
  await expect(page.getByRole('heading', { name: /E2E Public Treasurer/ })).toContainText(
    'Not public',
  );
  await expect(page.getByRole('link', { name: NAME })).toBeVisible();

  // The public site knows nothing about drafts.
  const response = await page.goto(`/races/${raceId}`);
  expect(response?.status()).toBe(404);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'E2E Public Treasurer' })).toHaveCount(0);
});

test('preview is for signed-in admins only', async ({ page }) => {
  await page.goto(`/admin/preview/races/${raceId}`);
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
});

test('once published, the race and profile are public, with sources', async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email);
  await page.goto(electionUrl);
  await press(page, 'Publish');
  await expect(page.locator('.page-header')).toContainText('Published');
  await page.goto(`/admin/races/${raceId}`);
  await press(page, 'Publish');
  await expect(page.locator('.page-header')).toContainText('Published');
  await page.locator('tr', { hasText: NAME }).getByRole('link', { name: NAME }).click();
  await expect(page).toHaveURL(/\/admin\/candidacies\/\d+/);
  const candidacyUrl = page.url();
  await page.getByRole('link', { name: NAME, exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/candidates\/\d+/);
  await press(page, 'Publish');
  await expect(page.locator('.page-header')).toContainText('Published');
  await page.goto(candidacyUrl);
  await press(page, 'Publish');
  await expect(page.locator('.page-header')).toContainText('Published');

  // A fresh visitor with no session.
  await page.context().clearCookies();
  await page.goto('/');
  await page.getByRole('link', { name: 'E2E Public Treasurer' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('E2E Public Treasurer');
  await expect(page.getByText('Listed alphabetically by last name.')).toBeVisible();
  await expect(page.locator('.candidate-list')).toContainText('Filed as of Mar 2, 2026');
  await expect(page.getByText('Not public')).toHaveCount(0);
  await expectNoSeriousA11yIssues(page);

  await page.getByRole('link', { name: NAME }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME);
  await page.getByText('Sources (').first().click();
  await expect(page.getByRole('link', { name: 'E2E public candidate list' }).first()).toBeVisible();
  await expectNoSeriousA11yIssues(page);
});

test('unpublishing takes a candidate off the public site at once', async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email);
  await page.goto(`/admin/races/${raceId}`);
  await page.locator('tr', { hasText: NAME }).getByRole('link', { name: NAME }).click();
  await expect(page).toHaveURL(/\/admin\/candidacies\/\d+/);
  await press(page, 'Unpublish');
  await expect(page.locator('.page-header')).toContainText('Unpublished');
  await page.context().clearCookies();
  await page.goto(`/races/${raceId}`);
  await expect(page.getByText('No candidates are published for this race yet.')).toBeVisible();
});

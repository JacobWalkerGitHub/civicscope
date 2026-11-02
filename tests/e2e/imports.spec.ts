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

const SOURCE_URL = 'https://elections.example.gov/e2e/import-list.csv';

async function upload(page: Page, csv: string, newSource = false) {
  await page.getByLabel('CSV file').setInputFiles({
    name: 'candidates.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await page.getByLabel('Source URL').fill(SOURCE_URL);
  if (newSource) {
    await page.getByLabel('Source title').fill('E2E candidate list');
    await page.getByLabel('Publisher').fill('E2E Board of Elections');
    await page.getByLabel('Source type').selectOption({ label: 'Official election authority' });
  }
  await page.getByRole('button', { name: 'Upload and preview' }).click();
  await expect(page.getByRole('heading', { name: 'candidates.csv' })).toBeVisible();
}

const row = (page: Page, name: string) => page.locator('tr', { hasText: name });

test.describe.configure({ mode: 'serial' });

let raceUrl = '';

test('the owner sets up a race to import into', async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email);
  await page.goto('/admin/offices/new');
  await page.getByLabel('Title').fill('E2E Import Commissioner');
  await page.getByLabel('Jurisdiction').selectOption({ label: 'Kentucky' });
  await page.getByLabel('Level').selectOption({ label: 'State' });
  await page.getByLabel('Branch').selectOption({ label: 'Executive' });
  await page.getByRole('button', { name: 'Create office' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Import Commissioner' })).toBeVisible();

  await page.goto('/admin/elections/new');
  await page.getByLabel('State').selectOption({ label: 'Kentucky' });
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('2027 E2E Import Election');
  await page.getByLabel('Type').selectOption({ label: 'General' });
  await page
    .getByLabel('Primary system')
    .selectOption({ label: 'Not applicable (general election)' });
  await page.getByLabel('Election date').fill('2027-11-09');
  await page.getByRole('button', { name: 'Create election' }).click();
  await expect(page.getByRole('heading', { name: '2027 E2E Import Election' })).toBeVisible();

  await page.getByText('Add a race').click();
  await page.getByLabel('Office').selectOption({ label: 'E2E Import Commissioner (Kentucky)' });
  await page.getByLabel('Race name').fill('E2E Import Race');
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Import Race' })).toBeVisible();
  raceUrl = page.url().split('?')[0]!;
});

test('a file with a bad row can be previewed but not applied', async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email);
  await page.goto(raceUrl);
  await page.getByRole('link', { name: 'Import candidates from a CSV file' }).click();
  await expect(page.getByLabel('Race')).toHaveValue(raceUrl.split('/').pop()!);
  await upload(
    page,
    'full_name,status,status_date\nAlex E2E Import,filed,2026-01-15\nBlake E2E Import,filed,\n',
    true,
  );
  await expect(row(page, 'Alex E2E Import')).toContainText('New person and candidacy');
  await expect(row(page, 'Blake E2E Import')).toContainText('status_date: Give the date');
  await expect(page.getByRole('button', { name: 'Apply import' })).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'Fix the rows' })).toBeVisible();
  await press(page, 'Discard');
  await expect(page.getByText('This import was discarded.')).toBeVisible();
});

test('a clean file is applied in one go, with drafts cited to the source', async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email);
  await page.goto('/admin/imports');
  await page.getByLabel('Race').selectOption(raceUrl.split('/').pop()!);
  await upload(
    page,
    'Full Name,Status,Status Date\nAlex E2E Import,filed,2026-01-15\nBlake E2E Import,announced,2026-01-10\n',
    // The discarded upload never created the source, so it is still new here.
    true,
  );
  await expect(page.getByText(/2 new, 0 added to the race/)).toBeVisible();
  await press(page, 'Apply import');
  await expect(page.getByRole('status')).toContainText('Applied');

  await page.goto(raceUrl);
  await expect(row(page, 'Alex E2E Import')).toContainText('Filed');
  await expect(row(page, 'Blake E2E Import')).toContainText('Draft');
  await row(page, 'Alex E2E Import').getByRole('link', { name: 'Alex E2E Import' }).click();
  await expect(page.getByRole('link', { name: 'E2E candidate list' }).first()).toBeVisible();
});

test('a hand edit is locked, and a disagreeing import goes to review', async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email);
  await page.goto(raceUrl);
  await row(page, 'Alex E2E Import').getByRole('link', { name: 'Alex E2E Import' }).click();
  await page.getByLabel('Name on the ballot').fill('Alex "AJ" E2E Import');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'Locked fields' })).toBeVisible();
  const candidacyUrl = page.url();

  await page.goto('/admin/imports');
  await page.getByLabel('Race').selectOption(raceUrl.split('/').pop()!);
  await upload(page, 'full_name,ballot_name\nAlex E2E Import,Alex J. E2E Import\n');
  await expect(row(page, 'Alex E2E Import')).toContainText('locked (changed by hand)');
  await press(page, 'Apply import');
  await expect(page.getByRole('status')).toContainText('1 locked field went to the review queue');

  await page.goto('/admin/review');
  const conflict = page.locator('.conflict', { hasText: 'Alex "AJ" E2E Import' });
  await expect(conflict).toContainText('the source says Alex J. E2E Import');
  await conflict.getByLabel('Why keep it? (optional)').fill('Campaign asked for the nickname');
  await conflict.getByRole('button', { name: 'Keep the current value' }).click();
  await expect(page.getByText('No import conflicts.')).toBeVisible();

  await page.goto(candidacyUrl);
  await expect(page.getByRole('heading', { name: /Alex "AJ" E2E Import/ })).toBeVisible();
});

test('editors cannot run imports', async ({ page }) => {
  await signIn(page, E2E_USERS.editor.email);
  await page.goto('/admin/imports');
  await expect(page.getByRole('heading', { name: 'Recent imports' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Upload a candidate list' })).toHaveCount(0);
});

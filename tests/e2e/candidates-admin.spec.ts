import { expect, test, type Locator, type Page } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS } from './users';

/*
 * Fixture names are prefixed "E2E" and URLs use example domains: this is test data in a
 * throwaway database, not real candidates.
 */

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

/** Opens a collapsible "add" form and returns it. */
async function openDetails(page: Page, summary: string): Promise<Locator> {
  const details = page.locator('details', { has: page.getByText(summary, { exact: true }) });
  await details.getByText(summary, { exact: true }).click();
  return details;
}

const header = (page: Page) => page.locator('.page-header');
const SOURCE_URL = 'https://elections.example.gov/e2e/candidate-list';

test.describe.configure({ mode: 'serial' });

let raceUrl = '';
let electionUrl = '';
let candidacyUrl = '';

test('set up an election and race to add candidates to', async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email);
  await page.goto('/admin/offices/new');
  await page.getByLabel('Title').fill('E2E Test Office');
  await page.getByLabel('Jurisdiction').selectOption({ label: 'Mississippi' });
  await page.getByLabel('Level').selectOption({ label: 'State' });
  await page.getByLabel('Branch').selectOption({ label: 'Executive' });
  await page.getByRole('button', { name: 'Create office' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Test Office' })).toBeVisible();

  await page.goto('/admin/elections/new');
  await page.getByLabel('State').selectOption({ label: 'Mississippi' });
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('E2E Mississippi General');
  await page.getByLabel('Election date').fill('2027-11-02');
  await page.getByRole('button', { name: 'Create election' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Mississippi General' })).toBeVisible();
  electionUrl = page.url();

  const add = await openDetails(page, 'Add a race');
  await add.getByLabel('Office').selectOption({ label: 'E2E Test Office (Mississippi)' });
  await add.getByLabel('Race name').fill('E2E Test Race');
  await add.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Test Race' })).toBeVisible();
  raceUrl = page.url();
});

test('a person needs a source before publishing', async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email);
  await page.getByRole('link', { name: 'Candidates' }).first().click();
  await page.getByRole('link', { name: 'New person' }).click();
  await expect(page.getByRole('heading', { name: 'New person' })).toBeVisible();
  await page.getByLabel('Full name').fill('Taylor E2E Example');
  await page.getByRole('button', { name: 'Create person' }).click();
  await expect(page.getByRole('heading', { name: 'Taylor E2E Example' })).toBeVisible();
  await expect(page.getByLabel('Sort name')).toHaveValue('Example, Taylor E2E');

  await press(page, 'Publish');
  await expect(page.getByRole('alert').filter({ hasText: /at least one source/ })).toBeVisible();
  await expect(header(page)).toContainText('Draft');

  // A new URL needs the source's details.
  const add = await openDetails(page, 'Add a source');
  await add.getByLabel('Source URL').fill(SOURCE_URL);
  await add.getByRole('button', { name: 'Add source' }).click();
  await expect(add.getByRole('alert')).toContainText('not a known source');

  await add.getByLabel('Source title').fill('E2E official candidate list');
  await add.getByLabel('Publisher').fill('E2E Board of Elections');
  await add.getByLabel('Source type').selectOption({ label: 'Official election authority' });
  await add.getByLabel('What it supports').selectOption({ label: 'Name' });
  await add.getByRole('button', { name: 'Add source' }).click();
  await expect(add.getByRole('status')).toHaveText('Source added.');
  await expect(page.getByRole('link', { name: 'E2E official candidate list' })).toBeVisible();
  await expect(page.getByText('Tier 1 · official record')).toBeVisible();

  await press(page, 'Publish');
  await expect(header(page)).toContainText('Published');
});

test('a candidacy publishes only with a public race and a sourced status', async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email);
  await page.goto(raceUrl);
  const add = await openDetails(page, 'Add a candidate');
  await add.getByLabel('Person').selectOption({ label: 'Example, Taylor E2E' });
  await add.getByRole('button', { name: 'Add candidate' }).click();
  await expect(page.getByRole('heading', { name: /Taylor E2E Example/ })).toBeVisible();
  candidacyUrl = page.url();

  await press(page, 'Publish');
  await expect(page.getByRole('alert').filter({ hasText: 'Publish the race first' })).toBeVisible();

  await page.goto(electionUrl);
  await press(page, 'Publish');
  await expect(header(page)).toContainText('Published');
  await page.goto(raceUrl);
  await press(page, 'Publish');
  await expect(header(page)).toContainText('Published');

  await page.goto(candidacyUrl);
  await press(page, 'Publish');
  await expect(page.getByRole('alert').filter({ hasText: /sourced status/ })).toBeVisible();

  // The source is already known, so only its URL is needed.
  const status = await openDetails(page, 'Record a status change');
  await status.getByLabel('Status').selectOption({ label: 'Filed' });
  await status.getByLabel('Source URL').fill(SOURCE_URL);
  await status.getByRole('button', { name: 'Record status' }).click();
  await expect(status.getByRole('status')).toHaveText('Status recorded.');
  await expect(page.getByText(/Current:\s*Filed/)).toBeVisible();

  await press(page, 'Publish');
  await expect(header(page)).toContainText('Published');

  // The race can't be hidden while a published candidate depends on it.
  await page.goto(raceUrl);
  await press(page, 'Unpublish');
  await expect(page.getByRole('alert').filter({ hasText: 'candidates first' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Filed' })).toBeVisible();

  // One source, cited twice: by the person and by the candidacy's status.
  await page.goto('/admin/sources');
  const row = page.getByRole('row', { name: /E2E official candidate list/ });
  await expect(row.getByRole('cell').last()).toHaveText('2');
});

test('an editor can record status but not publish a candidacy', async ({ page }) => {
  await signIn(page, E2E_USERS.editor.email);
  await page.goto(candidacyUrl);
  await expect(page.getByText('Record a status change')).toBeVisible();
  await expect(page.getByRole('button', { name: /Publish/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Archive' })).toHaveCount(0);
});

import { expect, test, type Locator, type Page } from '@playwright/test';
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

async function openDetails(page: Page, summary: string): Promise<Locator> {
  const details = page.locator('details', { has: page.getByText(summary, { exact: true }) });
  // Some open on their own (an empty list shows its "add" form); clicking would close them.
  await details.evaluate((d) => d.setAttribute('open', ''));
  return details;
}

async function addSource(page: Page, url: string, extra?: () => Promise<void>) {
  const add = await openDetails(page, 'Add a source');
  await add.getByLabel('Source URL').fill(url);
  await extra?.();
  await add.getByRole('button', { name: 'Add source' }).click();
  await expect(add.getByRole('status')).toHaveText('Source added.');
}

const badges = (page: Page) => page.locator('.page-header');
const TITLE = 'Proposes an E2E health care plan';

test.describe.configure({ mode: 'serial' });

let personUrl = '';
let entryUrl = '';

test('the owner publishes a person to attach entries to', async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email);
  await page.goto('/admin/candidates/new');
  await page.getByLabel('Full name').fill('Riley E2E Profile');
  await page.getByRole('button', { name: 'Create person' }).click();
  await expect(page.getByRole('heading', { name: 'Riley E2E Profile' })).toBeVisible();
  personUrl = page.url().split('?')[0]!;
  const add = await openDetails(page, 'Add a source');
  await add.getByLabel('Source URL').fill('https://elections.example.gov/e2e/riley');
  await add.getByLabel('Source title').fill('E2E filing record');
  await add.getByLabel('Publisher').fill('E2E Board of Elections');
  await add.getByLabel('Source type').selectOption({ label: 'Official election authority' });
  await add.getByRole('button', { name: 'Add source' }).click();
  await expect(add.getByRole('status')).toHaveText('Source added.');
  await press(page, 'Publish');
  await expect(badges(page)).toContainText('Published');
});

test('an editor drafts a position and sends it for review once it has a source', async ({
  page,
}) => {
  await signIn(page, E2E_USERS.editor.email);
  await page.goto(personUrl);
  await page.getByRole('link', { name: 'Add position' }).click();
  await expect(page.getByRole('heading', { name: /New position entry/ })).toBeVisible();
  await page.getByLabel('Issue').selectOption({ label: 'Health care' });
  await page.getByLabel('Type of statement').selectOption({ label: 'Campaign promise' });
  await page.getByLabel('Title').fill(TITLE);
  await page.getByLabel('Summary').fill('Says they would expand an example clinic program.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  // Positions need the candidate's exact words.
  await expect(page.locator('form').getByRole('alert')).toBeVisible();
  await page.getByLabel(/Their exact words/).fill('We will open more clinics.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
  entryUrl = page.url().split('?')[0]!;
  await expect(page.locator('p.muted', { hasText: 'The candidate’s own account' })).toBeVisible();

  await press(page, 'Send for review');
  await expect(page.getByRole('alert').filter({ hasText: /at least one source/ })).toBeVisible();

  await addSource(page, 'https://campaign.example/e2e/health', async () => {
    const add = page.locator('details', { has: page.getByText('Add a source', { exact: true }) });
    await add.getByLabel('Source title').fill('E2E campaign health plan');
    await add.getByLabel('Publisher').fill('E2E campaign');
    await add.getByLabel('Source type').selectOption({ label: 'Candidate or campaign material' });
  });
  await press(page, 'Send for review');
  await expect(badges(page)).toContainText('Waiting for review');
  await expect(page.getByText('A reviewer will check it')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve and publish' })).toHaveCount(0);
});

test('a reviewer sends it back with a note, and the editor sees why', async ({ page }) => {
  await signIn(page, E2E_USERS.reviewer.email);
  await page
    .getByRole('link', { name: /Review/ })
    .first()
    .click();
  await page.getByRole('link', { name: TITLE }).click();
  const box = page.locator('.review-box');
  await box.getByRole('button', { name: 'Send back' }).click();
  await expect(box.getByRole('alert')).toBeVisible();
  await box.getByLabel('What needs to change').fill('Quote the full sentence from the page.');
  await box.getByRole('button', { name: 'Send back' }).click();
  await expect(badges(page)).toContainText('Not yet reviewed');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
  await signIn(page, E2E_USERS.editor.email);
  await page.goto(entryUrl);
  await expect(page.getByRole('note')).toContainText('Quote the full sentence');
  await page.getByLabel(/Their exact words/).fill('We will open more clinics in every county.');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  await press(page, 'Send for review');
  await expect(badges(page)).toContainText('Waiting for review');
});

test('a reviewer approves and publishes it', async ({ page }) => {
  await signIn(page, E2E_USERS.reviewer.email);
  await page.goto(entryUrl);
  await page.locator('.review-box').getByRole('button', { name: 'Approve and publish' }).click();
  await expect(badges(page)).toContainText('Published');
  await expect(badges(page)).toContainText('Verified');
  await page.goto('/admin/review');
  await expect(page.getByText('Nothing is waiting for review.')).toBeVisible();
});

test('an editor’s change to a published entry takes it down until reviewed', async ({ page }) => {
  await signIn(page, E2E_USERS.editor.email);
  await page.goto(entryUrl);
  await expect(page.getByText(/Saving changes takes it off the public site/)).toBeVisible();
  await page
    .getByLabel('Summary')
    .fill('Says they would expand an example clinic program statewide.');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(badges(page)).toContainText('Unpublished');
  await expect(badges(page)).toContainText('Waiting for review');

  await page.goto('/admin/review');
  await expect(page.getByText('edited after publishing')).toBeVisible();
});

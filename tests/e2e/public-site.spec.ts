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

  // Every profile links to the correction form, pre-filled with the page.
  const profilePath = new URL(page.url()).pathname;
  await page.getByRole('link', { name: 'Report an error on this page' }).click();
  await expect(page.getByLabel('Page with the error')).toHaveValue(profilePath);
});

// A valid 1x1 PNG; the server checks the bytes, not the file name.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test('an uploaded photo shows on the profile with its credit', async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email);
  await page.goto(`/admin/races/${raceId}`);
  await page.locator('tr', { hasText: NAME }).getByRole('link', { name: NAME }).click();
  await page.getByRole('link', { name: NAME, exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/candidates\/\d+/);

  // A file that is not really an image is refused.
  const upload = page.locator('details', { hasText: 'Upload a photo' });
  await upload.locator('summary').click();
  await upload.getByLabel('Photo file').setInputFiles({
    name: 'fake.png',
    mimeType: 'image/png',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
  });
  await upload.getByLabel('Where it came from').fill('https://campaign.example.com/press');
  await upload.getByLabel('Credit').fill('E2E campaign');
  await upload.getByRole('button', { name: 'Upload photo' }).click();
  await expect(upload.getByRole('alert').first()).toContainText(/JPEG, PNG or WebP/);

  await upload.getByLabel('Photo file').setInputFiles({
    name: 'dana.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await upload.getByLabel('Where it came from').fill('https://campaign.example.com/press');
  await upload.getByLabel('Credit').fill('E2E campaign');
  await upload.getByRole('button', { name: 'Upload photo' }).click();
  await expect(page.getByAltText(`Current photo of ${NAME}`)).toBeVisible();

  // Links to private addresses are refused before anything is fetched.
  const link = page.locator('details', { hasText: 'from a link' });
  await link.locator('summary').click();
  await link.getByLabel('Image link').fill('https://127.0.0.1/photo.png');
  await link.getByLabel('Page it appears on').fill('https://campaign.example.com/press');
  await link.getByLabel('Credit').fill('E2E campaign');
  await link.getByRole('button', { name: 'Copy photo from link' }).click();
  await expect(link.getByRole('alert').first()).toContainText('private network');

  await page.context().clearCookies();
  await page.goto(`/races/${raceId}`);
  await page.getByRole('link', { name: NAME }).click();
  const img = page.locator('figure img');
  await expect(img).toBeVisible();
  const src = await img.getAttribute('src');
  const res = await page.request.get(src!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('image/png');
  expect(res.headers()['content-security-policy']).toBe("default-src 'none'; sandbox");
  // Pages get the site-wide policy instead.
  const pageRes = await page.request.get('/');
  expect(pageRes.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  const health = await page.request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: 'ok' });
  await expect(page.getByRole('link', { name: 'E2E campaign' })).toHaveAttribute(
    'href',
    'https://campaign.example.com/press',
  );
  await expectNoSeriousA11yIssues(page);
});

test('the candidate directory searches and filters', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('link', { name: 'Candidates' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Candidates');
  await expect(page.getByRole('link', { name: NAME })).toBeVisible();
  await expectNoSeriousA11yIssues(page);

  await page.getByLabel('Name').fill('dana e2e');
  await page.getByLabel('State').selectOption({ label: 'Kentucky' });
  await page.getByLabel('Level').selectOption({ label: 'State' });
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/q=dana/);
  await expect(page.getByRole('status')).toContainText('1 candidacy');
  await expect(page.getByRole('link', { name: NAME })).toBeVisible();

  await page.getByLabel('Level').selectOption({ label: 'Federal' });
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('status')).toHaveText('No candidates match.');

  // Drafts never show up, even by exact name.
  await page.goto(`/candidates?q=${encodeURIComponent('no such e2e person')}`);
  await expect(page.getByRole('status')).toHaveText('No candidates match.');
});

test('search, comparison and issue pages show public records with sources', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Search' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Search');
  await page.getByLabel('Name, office, state, district or issue').fill('dana e2e');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('status')).toContainText('Results for');
  await expect(page.getByRole('link', { name: NAME })).toBeVisible();
  await expectNoSeriousA11yIssues(page);

  await page.getByLabel('Name, office, state, district or issue').fill('public treasurer kentucky');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('region', { name: 'Races' })).toContainText('E2E Public Treasurer');
  await page.goto(`/search?q=${encodeURIComponent('no such e2e thing')}`);
  await expect(page.getByRole('status')).toContainText('Nothing matches');

  // Comparing: IDs from elsewhere are ignored, empty cells say so.
  await page.goto(`/races/${raceId}/compare?c=999999`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Compare candidates');
  const table = page.getByRole('table');
  await expect(table.getByRole('columnheader', { name: NAME })).toBeVisible();
  await expect(table.getByRole('row', { name: /Background/ })).toContainText('Nothing on file');
  await expect(table.getByRole('row', { name: /On the ballot/ })).toContainText('Filed');
  await expectNoSeriousA11yIssues(page);

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Issues' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Issues');
  await expectNoSeriousA11yIssues(page);
  await page.locator('.issue-list a').first().click();
  await expect(page.getByText('No positions on this issue are published')).toBeVisible();
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

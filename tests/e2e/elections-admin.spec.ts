import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS } from './users';

async function signIn(page: Page, email: string) {
  await page.goto('/admin/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

/** Clicks a toolbar/history button, accepting its confirmation dialog if it has one. */
async function press(page: Page, name: string | RegExp) {
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name, exact: typeof name === 'string' }).click();
}

const status = (page: Page) => page.locator('.page-header');

async function noSeriousA11yIssues(page: Page) {
  // Next.js streams a page's generated <title> in after the content; wait for it first.
  await expect(page).toHaveTitle(/\S/);
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test.describe.configure({ mode: 'serial' });

test('the owner sets up an election and race, and publishes them in order', async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email);

  // Office
  await page.getByRole('link', { name: 'Offices' }).first().click();
  await page.getByRole('link', { name: 'New office' }).click();
  await expect(page.getByRole('heading', { name: 'New office' })).toBeVisible();
  await page.getByLabel('Title').fill('Governor');
  await page.getByLabel('Jurisdiction').selectOption({ label: 'Kentucky' });
  await page.getByLabel('Level').selectOption({ label: 'State' });
  await page.getByLabel('Branch').selectOption({ label: 'Executive' });
  await page.getByLabel('Term length (years)').fill('4');
  await page.getByRole('button', { name: 'Create office' }).click();
  await expect(page.getByRole('heading', { name: 'Governor' })).toBeVisible();

  // Election
  await page.getByRole('link', { name: 'Elections' }).first().click();
  await page.getByRole('link', { name: 'New election' }).click();
  await expect(page.getByRole('heading', { name: 'New election' })).toBeVisible();
  await page.getByLabel('State').selectOption({ label: 'Kentucky' });
  await page
    .getByRole('textbox', { name: 'Name', exact: true })
    .fill('2027 Kentucky General Election');
  await page.getByLabel('Type').selectOption({ label: 'General' });
  await page
    .getByLabel('Primary system')
    .selectOption({ label: 'Not applicable (general election)' });
  await page.getByLabel('Election date').fill('2027-11-02');
  await page.getByRole('button', { name: 'Create election' }).click();
  await expect(page.getByRole('heading', { name: '2027 Kentucky General Election' })).toBeVisible();
  await expect(status(page)).toContainText('Draft');
  const electionUrl = page.url();

  // Race
  // Opens on its own while the election has no races.
  await expect(page.locator('details', { hasText: 'Add a race' })).toHaveAttribute('open', '');
  await page.getByLabel('Office').selectOption({ label: 'Governor (Kentucky)' });
  await page.getByLabel('Race name').fill('Governor of Kentucky');
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByRole('heading', { name: 'Governor of Kentucky' })).toBeVisible();

  // A race can't go public before its election.
  await press(page, 'Publish');
  await expect(page.getByRole('alert').filter({ hasText: /election/i })).toBeVisible();
  await expect(status(page)).toContainText('Draft');

  await page.goto(electionUrl);
  await press(page, 'Publish');
  await expect(status(page)).toContainText('Published');

  await page.getByRole('link', { name: 'Governor of Kentucky' }).click();
  await press(page, 'Publish');
  await expect(status(page)).toContainText('Published');
  await expect(page.getByRole('cell', { name: 'Published' })).toBeVisible();
});

test('key dates and official links show on the public election calendar', async ({ page }) => {
  // Fixture values: not a real deadline or official page.
  await signIn(page, E2E_USERS.owner.email);
  await page.getByRole('link', { name: 'Elections' }).first().click();
  await page.getByRole('link', { name: '2027 Kentucky General Election' }).click();

  await page.getByText('Add a date').click();
  const dateForm = page.locator('details', { hasText: 'Add a date' });
  await dateForm.getByLabel('Kind of date').selectOption({ label: 'Voter registration deadline' });
  await dateForm.getByRole('textbox', { name: 'Date', exact: true }).fill('2027-10-04');
  await dateForm.getByLabel('Description').fill('Registration closes (test fixture)');
  // A date must name its official source.
  await dateForm.getByRole('button', { name: 'Add date' }).click();
  await expect(dateForm.getByText(/official source/)).toBeVisible();
  await dateForm.getByLabel('Official source').fill('https://elections.example.gov/2027.pdf');
  await dateForm.getByRole('button', { name: 'Add date' }).click();
  await expect(
    page.getByRole('cell', { name: 'Registration closes (test fixture)' }),
  ).toBeVisible();

  await page.getByText('Add a link').click();
  const linkForm = page.locator('details', { hasText: 'Add a link' });
  await linkForm.getByLabel('Kind of link').selectOption({ label: 'Election office' });
  await linkForm.getByLabel('Label').fill('Example State Board of Elections');
  await linkForm.getByLabel('Address').fill('https://elections.example.gov/');
  await linkForm.getByRole('button', { name: 'Add link' }).click();
  await expect(page.getByRole('link', { name: 'Example State Board of Elections' })).toBeVisible();

  await page.goto('/elections?year=2027');
  await expect(page.getByRole('heading', { name: 'Election calendar' })).toBeVisible();
  await expect(page.getByText('Voter registration deadline')).toBeVisible();
  await noSeriousA11yIssues(page);
  await page.getByRole('link', { name: '2027 Kentucky General Election' }).click();
  await expect(page.getByRole('heading', { name: '2027 Kentucky General Election' })).toBeVisible();
  await expect(
    page.locator('.timeline li').filter({ hasText: /Registration closes \(test fixture\)/ }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'elections.example.gov' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Example State Board of Elections' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Governor of Kentucky' })).toBeVisible();
  await noSeriousA11yIssues(page);
});

test('an earlier version of a party can be restored', async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email);
  await page.getByRole('link', { name: 'Parties' }).first().click();
  await page.getByRole('link', { name: 'New party' }).click();
  await expect(page.getByRole('heading', { name: 'New party' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('E2E Example Party');
  await page.getByLabel('Short name').fill('EEP');
  await page.getByRole('button', { name: 'Create party' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Example Party' })).toBeVisible();

  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('E2E Renamed Party');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Renamed Party' })).toBeVisible();

  await press(page, 'Restore version 1');
  await expect(page.getByRole('heading', { name: 'E2E Example Party' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Restored version 1/ })).toBeVisible();
});

test('an editor can edit but cannot publish or archive', async ({ page }) => {
  await signIn(page, E2E_USERS.editor.email);
  await page.getByRole('link', { name: 'Elections' }).first().click();
  await page.getByRole('link', { name: '2027 Kentucky General Election' }).click();
  await page.getByText('Edit election details').click();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Publish/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Archive' })).toHaveCount(0);
});

test('a viewer sees records but no edit controls', async ({ page }) => {
  await signIn(page, E2E_USERS.viewer.email);
  await page.goto('/admin/parties');
  await expect(page.getByRole('link', { name: 'New party' })).toHaveCount(0);
  await page.goto('/admin/elections/new');
  await expect(page).toHaveURL(/forbidden/);
});

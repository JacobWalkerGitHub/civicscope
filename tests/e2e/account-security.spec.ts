import { expect, test, type Page } from '@playwright/test';
import { totpCode, totpStep } from '@civicscope/auth';
import { E2E_PASSWORD, E2E_USERS } from './users';

const INVITEE = 'invitee@e2e.test';
const INVITEE_PASSWORD = 'invitee-password-long-enough';

async function signIn(page: Page, email: string, password = E2E_PASSWORD) {
  await page.goto('/admin/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/sign-in/);
}

test.describe.configure({ mode: 'serial' });

let inviteLink = '';
let setupKey = '';
let recoveryCode = '';

test('the owner invites someone with a one-time link', async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email);
  await page.getByRole('link', { name: 'Users' }).click();
  await page.getByLabel('Email').fill(INVITEE);
  await page
    .locator('form', { hasText: 'Create invitation link' })
    .getByLabel('Role')
    .selectOption('editor');
  await page.getByRole('button', { name: 'Create invitation link' }).click();
  const link = page.getByLabel('Invitation link');
  await expect(link).toBeVisible();
  inviteLink = await link.inputValue();
  expect(inviteLink).toMatch(/\/admin\/invite\/[\w-]{40,}$/);
  await expect(page.getByRole('cell', { name: INVITEE })).toBeVisible();
});

test('the invitee creates their account, and the link stops working', async ({ page }) => {
  await page.goto(inviteLink);
  await expect(page.getByText(`with the email ${INVITEE}`)).toBeVisible();
  await page.getByLabel('Your name').fill('E2E Invitee');
  await page.getByLabel('Password (at least 12 characters)').fill(INVITEE_PASSWORD);
  await page.getByLabel('Password again').fill(INVITEE_PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Your account is ready.')).toBeVisible();

  await page.goto(inviteLink);
  await expect(page.getByRole('heading', { name: 'Invitation not valid' })).toBeVisible();

  await signIn(page, INVITEE, INVITEE_PASSWORD);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('editor', { exact: true })).toBeVisible();
});

test('two-step sign-in is set up with an authenticator code', async ({ page }) => {
  await signIn(page, INVITEE, INVITEE_PASSWORD);
  await page.getByRole('link', { name: 'E2E Invitee' }).click();
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  await page.getByRole('button', { name: 'Set up two-step sign-in' }).click();
  const key = page.getByLabel('Setup key');
  await expect(key).toBeVisible();
  setupKey = (await key.textContent())!.trim();

  await page.getByLabel('Code from your app').fill('000000');
  await page.getByRole('button', { name: 'Turn on two-step sign-in' }).click();
  await expect(page.locator('form').getByRole('alert')).toContainText('didn’t match');

  await page.getByLabel('Code from your app').fill(totpCode(setupKey, totpStep(new Date())));
  await page.getByRole('button', { name: 'Turn on two-step sign-in' }).click();
  const codes = page.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem');
  await expect(codes).toHaveCount(10);
  recoveryCode = (await codes.first().textContent())!.trim();
});

test('signing in then needs a code, and a recovery code works once', async ({ page }) => {
  await signIn(page, INVITEE, INVITEE_PASSWORD);
  await expect(page).toHaveURL(/\/admin\/sign-in\/verify$/);
  await page.getByLabel('Code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.locator('form').getByRole('alert')).toContainText('didn’t work');

  await page.getByLabel('Code').fill(recoveryCode);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('You signed in with a recovery code. You have 9 left')).toBeVisible();
  await signOut(page);

  // The next 30-second step's code is accepted (one step of clock drift is allowed),
  // and is never the one used during setup.
  await signIn(page, INVITEE, INVITEE_PASSWORD);
  await page.getByLabel('Code').fill(totpCode(setupKey, totpStep(new Date()) + 1));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('the owner can reset two-step and disable an account', async ({ page, browser }) => {
  await signIn(page, E2E_USERS.owner.email);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.goto('/admin/users');
  const row = page.locator('tr', { hasText: INVITEE });
  await expect(row).toContainText('On');
  await row.getByRole('button', { name: 'Reset' }).click();
  await expect(row).toContainText('Off');

  // No controls on your own row.
  const mine = page.locator('tr', { hasText: '(you)' });
  await expect(mine.getByRole('button')).toHaveCount(0);

  await row.getByRole('button', { name: 'Disable' }).click();
  await expect(row).toContainText('Disabled');

  const other = await browser.newPage();
  await signIn(other, INVITEE, INVITEE_PASSWORD);
  await expect(other.locator('form').getByRole('alert')).toHaveText(
    'Email or password is incorrect.',
  );
  await other.close();
});

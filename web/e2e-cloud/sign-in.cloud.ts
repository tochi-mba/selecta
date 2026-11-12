import { BrowserContext, expect, Page, test } from '@playwright/test';

// SC-0400-05: sign-up, sign-in, Google sign-in, forgot password and email verification all run on
// AuthKit's hosted pages on our auth domain. This runs the real @workos-inc/authkit-react (the
// site at http://localhost:<port>, built by vite.cloud-e2e-authkit.config.ts) against a fake
// AuthKit (tests/e2e_cloud_authkit.py). The auth domain, https://auth.e2e.test, is routed to that
// fake, so every redirect, the PKCE code exchange and the token the API checks are the real
// library's. A WorkOS staging walkthrough still has to prove the real hosted pages.

const AUTH = 'https://auth.e2e.test';
const CLIENT_ID = 'client_e2e';
const PASSWORD = 'correct horse battery staple';

let server = '';
let site = '';

test.beforeAll(({}, info) => {
  server = String(info.project.use.baseURL);
  site = server.replace('127.0.0.1', 'localhost');
});

/** A browser whose requests to the auth domain reach the fake AuthKit on the test server. */
async function browserWithAuthDomain(context: BrowserContext): Promise<Page> {
  await context.route(`${AUTH}/**`, async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${server}/fake-authkit${url.pathname}${url.search}`, maxRedirects: 0 });
    await route.fulfill({ response });
  });
  return context.newPage();
}

function email(name: string): string {
  return `${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

/** The authorize request the page is on, as AuthKit receives it. */
function authorizeQuery(page: Page): Record<string, string> {
  const url = new URL(page.url());
  expect(`${url.origin}${url.pathname}`).toBe(`${AUTH}/user_management/authorize`);
  return Object.fromEntries(url.searchParams);
}

function expectOurClient(query: Record<string, string>) {
  expect(query.client_id).toBe(CLIENT_ID);
  expect(query.redirect_uri).toBe(site);
  expect(query.response_type).toBe('code');
  expect(query.code_challenge_method).toBe('S256');
  expect(query.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
}

async function welcome(page: Page, path = '/') {
  await page.goto(`${site}${path}`);
  await expect(page.getByRole('heading', { name: 'Your music, ready to move.' })).toBeVisible();
}

async function hostedForm(page: Page, address: string, button: string) {
  await page.getByLabel('Email').fill(address);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: button }).click();
}

/** Sign in on the hosted page from the welcome screen; returns the authorize query. */
async function signInWithPassword(page: Page, address: string, path = '/') {
  await welcome(page, path);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to Selecta' })).toBeVisible();
  const query = authorizeQuery(page);
  await hostedForm(page, address, 'Sign in');
  return query;
}

async function signUpVerified(context: BrowserContext, address: string) {
  const page = await browserWithAuthDomain(context);
  await welcome(page);
  await page.getByRole('button', { name: 'Create your account' }).click();
  await hostedForm(page, address, 'Create account');
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
  await page.request.post(`${server}/test/authkit/verify`, { data: { email: address } });
  await signInWithPassword(page, address);
  await page.getByLabel(/at least 13 years old/).check();
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your music workspace');
  await page.close();
}

test('Create account goes to the hosted sign-up page and an unverified email gets the verify screen', async ({ context }) => {
  const page = await browserWithAuthDomain(context);
  const address = email('new');
  await welcome(page);

  await page.getByRole('button', { name: 'Create your account' }).click();
  await expect(page.getByRole('heading', { name: 'Create your Selecta account' })).toBeVisible();
  const query = authorizeQuery(page);
  expectOurClient(query);
  expect(query.provider).toBe('authkit');
  expect(query.screen_hint).toBe('sign-up');

  await hostedForm(page, address, 'Create account');
  // Back on our site, signed in by the code exchange, but the email isn't verified yet.
  expect(new URL(page.url()).origin).toBe(site);
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
  await expect(page.getByText(`Open the verification email for ${address}`)).toBeVisible();
  await expect(page).not.toHaveURL(/[?&]code=/);
});

test('Sign in goes to the hosted page, and the callback returns the person signed in where they started', async ({ context }) => {
  const address = email('returning');
  await signUpVerified(context, address);
  const page = await browserWithAuthDomain(context);

  const query = await signInWithPassword(page, address, '/library');
  expectOurClient(query);
  expect(query.provider).toBe('authkit');
  expect(query.screen_hint).toBeUndefined();
  expect(JSON.parse(query.state)).toEqual({ returnTo: '/library' });

  await expect(page).toHaveURL(`${site}/library`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your library');
  await expect(page.getByRole('navigation', { name: 'Cloud workspace' })).toBeVisible();
});

test('Google sign-in goes through AuthKit with the Google provider and reaches the account with the same verified email', async ({ context, browser }) => {
  const address = email('google');
  await signUpVerified(context, address);
  const fresh = await browser.newContext();
  const page = await browserWithAuthDomain(fresh);
  await welcome(page);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('link', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a Google account' })).toBeVisible();
  const query = authorizeQuery(page);
  expectOurClient(query);
  expect(query.provider).toBe('GoogleOAuth');
  expect(query.screen_hint).toBeUndefined();
  await page.getByLabel('Google account email').fill(address);
  await page.getByRole('button', { name: 'Continue' }).click();

  // The existing, already set-up account: no onboarding, straight to the workspace.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your music workspace');
  await expect(page.getByRole('heading', { name: 'Set up your Selecta workspace' })).toHaveCount(0);
  await fresh.close();
});

test('a Google identity whose email is not verified is not linked and gets the verify screen', async ({ context }) => {
  const address = email('unlinked');
  await signUpVerified(context, address);
  const page = await browserWithAuthDomain(context);
  await welcome(page);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Continue with Google' }).click();
  await page.getByLabel('Google account email').fill(address);
  await page.getByLabel('Google has verified this email').uncheck();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your music workspace' })).toHaveCount(0);
});

test('Forgot password leads to the hosted reset page, which says the same for any email', async ({ context }) => {
  const known = email('forgetful');
  await signUpVerified(context, known);
  const said: string[] = [];
  for (const address of [known, email('nobody')]) {
    const page = await browserWithAuthDomain(context);
    await welcome(page);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    expect(new URL(page.url()).origin).toBe(AUTH);
    expect(new URL(page.url()).pathname).toBe('/user_management/hosted/reset-password');
    await page.getByLabel('Email').fill(address);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    said.push(await page.locator('main').innerText());
    await page.close();
  }
  expect(said[0]).toBe(said[1]);
  const log = await (await context.request.get(`${server}/test/authkit/log`)).json() as { kind: string; known?: boolean }[];
  expect(log.filter((entry) => entry.kind === 'reset').slice(-2).map((entry) => entry.known)).toEqual([true, false]);
});

test('a reset link sets a new password once, and only the new password signs in', async ({ context }) => {
  const address = email('reset');
  await signUpVerified(context, address);
  const page = await browserWithAuthDomain(context);
  await welcome(page);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email').fill(address);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  const { link } = await (await context.request.get(`${server}/test/authkit/reset-link?email=${encodeURIComponent(address)}`)).json() as { link: string };
  const hosted = `${AUTH}${link.replace('/fake-authkit', '')}`;
  await page.goto(hosted);
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await page.getByLabel('New password').fill('a brand new passphrase');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByRole('heading', { name: 'Password changed' })).toBeVisible();
  await page.goto(hosted);
  await expect(page.getByRole('heading', { name: 'This reset link has expired' })).toBeVisible();

  await welcome(page);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await hostedForm(page, address, 'Sign in');
  await expect(page.getByText('Incorrect email or password.')).toBeVisible();
  await welcome(page);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Email').fill(address);
  await page.getByLabel('Password').fill('a brand new passphrase');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your music workspace');
});

test('cancelling on the hosted page comes back to the welcome screen with a plain reason', async ({ context }) => {
  const page = await browserWithAuthDomain(context);
  await page.goto(`${site}/?error=access_denied&error_description=${encodeURIComponent('Visit evil.test')}`);
  await expect(page.getByRole('alert')).toHaveText('Sign-in was cancelled. Choose Sign in to try again.');
  await expect(page.getByText('evil.test')).toHaveCount(0);
  await expect(page).toHaveURL(`${site}/`);
});

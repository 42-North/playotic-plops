// Live-mode build against the local Supabase stand-in (real migration on real Postgres,
// real Edge Function handler). Turnstile and Geoapify are stubbed at the network layer.
import { expect, test, type Page } from '@playwright/test';
import { offlineMap, shotDir } from './helpers';

const BASE = 'http://localhost:4318/playotic-plops/';

async function stubs(page: Page) {
  await offlineMap(page);
  await page.route('https://challenges.cloudflare.com/**', (r) => r.fulfill({
    contentType: 'text/javascript',
    body: `window.turnstile = { render(el, o) { this.o = o; return 'w1'; }, execute() { setTimeout(() => this.o.callback('stub-turnstile-token-' + Date.now()), 10); }, reset() {}, remove() {} };`,
  }));
  await page.route('https://api.geoapify.com/v1/geocode/search**', (r) => r.fulfill({ json: { results: [{ lat: 34.05, lon: -101.5, address_line1: 'Testville, TX', address_line2: 'United States' }] } }));
  await page.route('https://api.geoapify.com/v1/geocode/reverse**', (r) => r.fulfill({ json: { results: [] } }));
  await page.route('https://api.geoapify.com/v1/routing**', (r) => {
    const wp = new URL(r.request().url()).searchParams.get('waypoints')!.split('|');
    const via = wp.length === 3;
    r.fulfill({ json: { features: [{ geometry: { type: 'MultiLineString', coordinates: [[[-101.5, 33.9], [-101.5, 34.2]]] }, properties: { distance: 33_000, time: via ? 1800 + 300 : 1800 } }] } });
  });
}

const stamp = Date.now().toString(36);
const NAME = `Live Fuel ${stamp}`;

test.describe.configure({ mode: 'serial' });

test('live flow: add, rate from another browser, vote, edit; no demo data', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'one full live run is enough');
  const creator = await browser.newPage();
  await stubs(creator);
  await creator.goto(`${BASE}#/add`);
  await expect(creator.getByRole('note')).toHaveCount(0); // no demo banner in live mode
  await creator.getByPlaceholder('Address, exit, or town').fill('Testville');
  await creator.getByPlaceholder('Address, exit, or town').press('Enter');
  await expect(creator.getByText(/Pin at 34\.05/)).toBeVisible();
  await creator.getByLabel('Name').fill(NAME);
  await creator.getByLabel('Address or highway location').fill('1 Live Test Rd');
  await creator.getByRole('radio', { name: /^5 plops/ }).check({ force: true });
  await creator.getByRole('button', { name: 'Add stop' }).click();
  await expect(creator.getByRole('heading', { name: NAME })).toBeVisible();
  await expect(creator.getByText('Stop added. Thanks for helping the next traveler!')).toBeVisible();
  const url = creator.url();
  await expect(creator.getByText('You added this stop and its original rating.')).toBeVisible();

  // A second browser = a second pseudonymous identity.
  const ctx = await browser.newContext();
  const visitor = await ctx.newPage();
  await stubs(visitor);
  await visitor.goto(url);
  await expect(visitor.getByText('No crowd ratings yet')).toBeVisible();
  await visitor.getByRole('button', { name: /^Agree/ }).click();
  await expect(visitor.getByText('1 agree')).toBeVisible();
  await expect(visitor.getByText('No crowd ratings yet')).toBeVisible(); // votes don't create crowd scores
  await visitor.getByRole('link', { name: /Add your rating/ }).click();
  await visitor.getByRole('radio', { name: /^3 plops/ }).check({ force: true });
  await visitor.getByLabel(/next traveler/).fill('<b>bold?</b> fine');
  await visitor.getByRole('button', { name: 'Submit 3 plops' }).click();
  await expect(visitor.getByText('Thanks! Your plops were added to the crowd score.')).toBeVisible();
  await expect(visitor.getByText(/^1 crowd rating/)).toBeVisible();
  await expect(visitor.getByText('“<b>bold?</b> fine”')).toBeVisible();
  await visitor.getByRole('link', { name: /Edit your rating/ }).click();
  await expect(visitor.getByText(/Saving replaces your earlier rating/)).toBeVisible();
  await visitor.getByRole('radio', { name: /^4 plops/ }).check({ force: true });
  await visitor.getByRole('button', { name: 'Update to 4 plops' }).click();
  await expect(visitor.getByText('Your rating was updated.')).toBeVisible();
  await expect(visitor.getByText(/^1 crowd rating/)).toBeVisible();
  await expect(visitor.locator('.crowd-big .num')).toHaveText('4.0');
  await visitor.screenshot({ path: `${shotDir}/live-detail.png`, fullPage: true });

  // Creator reloads: sees shared data from the other browser.
  await creator.reload();
  await expect(creator.locator('.crowd-big .num')).toHaveText('4.0');
  await expect(creator.getByText('1 agree')).toBeVisible();
  await ctx.close();
});

test('live route search shows calculated detours labelled as such', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one live run is enough');
  await stubs(page);
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Along a route' }).click();
  await page.getByPlaceholder('From: city or address').fill('Testville');
  await page.getByPlaceholder('From: city or address').press('Enter');
  await page.getByPlaceholder('To: city or address').fill('Testville');
  await page.getByPlaceholder('To: city or address').press('Enter');
  await page.getByRole('button', { name: 'Find stops' }).click();
  await expect(page.getByText(/about 30 min driving/)).toBeVisible();
  await expect(page.getByText('Adds 5 min (calculated)').first()).toBeVisible();
  await page.screenshot({ path: `${shotDir}/live-route.png` });
});

test('live backend refuses direct writes and private reads', async ({ request }) => {
  const write = await request.post('http://localhost:54321/rest/v1/rpc/api_submit_rating', { data: {} });
  expect(write.status()).toBe(401);
  const foreign = await request.post('http://localhost:54321/functions/v1/plops', { headers: { origin: 'https://evil.example' }, data: { action: 'me' } });
  expect(foreign.status()).toBe(403);
});

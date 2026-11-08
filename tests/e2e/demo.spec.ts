import { expect, test } from '@playwright/test';
import { offlineMap, shotDir, trackRequests } from './helpers';

const BASE = 'http://localhost:4317/playotic-plops/';
const LONE_STAR = 'd0000000-0000-4000-8000-000000000001';

test.beforeEach(async ({ page }) => {
  await offlineMap(page);
});

test('loads under a repository subpath with every asset resolved', async ({ page }, info) => {
  const failures: string[] = [];
  page.on('response', (r) => { if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`); });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const urls = trackRequests(page);
  await page.goto(BASE);
  await expect(page.getByRole('heading', { name: 'Find your next good plop.' })).toBeVisible();
  await expect(page.getByRole('note')).toContainText('Demo mode');
  await expect(page.getByRole('link', { name: 'Lone Star Travel Stop' })).toBeVisible();
  expect(failures).toEqual([]);
  expect(errors).toEqual([]);
  // assets come from the subpath, and browsing loads no challenge or analytics scripts
  expect(urls.filter((u) => u.startsWith('http://localhost:4317/') && !u.startsWith(BASE))).toEqual([]);
  expect(urls.some((u) => u.includes('challenges.cloudflare.com'))).toBe(false);
  await page.screenshot({ path: `${shotDir}/${info.project.name}-explore.png` });
});

test('direct links and refreshes work with hash routing', async ({ page }, info) => {
  await page.goto(`${BASE}#/stop/${LONE_STAR}`);
  await expect(page.getByRole('heading', { name: 'Lone Star Travel Stop' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Lone Star Travel Stop' })).toBeVisible();
  await expect(page.getByText('18 crowd ratings')).toBeVisible();
  await page.screenshot({ path: `${shotDir}/${info.project.name}-detail.png`, fullPage: true });
  await page.goto(`${BASE}#/privacy`);
  await expect(page.getByRole('heading', { name: 'Privacy' })).toBeVisible();
  await page.goto(`${BASE}#/guide`);
  await expect(page.getByRole('heading', { name: 'The plop scale' })).toBeVisible();
});

test('search without location, map view and pin selection', async ({ page }, info) => {
  let asked = false;
  await page.exposeFunction('__geoAsked', () => { asked = true; });
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = () => { (window as any).__geoAsked(); };
  });
  await page.goto(BASE);
  await page.getByRole('searchbox').fill('Temple');
  await page.getByRole('searchbox').press('Enter');
  await expect(page.getByText(/straight-line distance from Temple, TX/)).toBeVisible();
  if (info.project.name === 'phone') await page.getByRole('button', { name: 'Map' }).click();
  const pin = page.getByRole('button', { name: /^Pecan Grove Gas & Go: crowd/ });
  await expect(pin).toBeVisible({ timeout: 20_000 });
  await pin.click();
  await expect(page.locator('.map-card').getByRole('link', { name: 'Pecan Grove Gas & Go' })).toBeVisible();
  await page.screenshot({ path: `${shotDir}/${info.project.name}-map.png` });
  expect(asked).toBe(false);
});

test('route view uses honest labels in demo mode', async ({ page }, info) => {
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Along a route' }).click();
  await page.getByPlaceholder('From: city or address').fill('Dallas');
  await page.getByPlaceholder('From: city or address').press('Enter');
  await page.getByPlaceholder('To: city or address').fill('Austin');
  await page.getByPlaceholder('To: city or address').press('Enter');
  await page.getByRole('button', { name: 'Find stops' }).click();
  await expect(page.getByText('Sample route (demo).')).toBeVisible();
  await expect(page.getByText(/Adds \d+ min/)).toHaveCount(0);
  await expect(page.getByText(/ahead along sample line/).first()).toBeVisible();
  await page.screenshot({ path: `${shotDir}/${info.project.name}-route.png` });
});

test('adding a stop in demo mode is clearly not shared', async ({ page }, info) => {
  await page.goto(`${BASE}#/add`);
  await page.getByPlaceholder('Address, exit, or town').fill('Georgetown');
  await page.getByPlaceholder('Address, exit, or town').press('Enter');
  await expect(page.getByText(/Pin at 30\.63/)).toBeVisible();
  await page.getByLabel('Name').fill('Demo Test Fuel');
  await page.getByLabel('Address or highway location').fill('1 Demo Way');
  await page.getByRole('radio', { name: /^5 plops/ }).check({ force: true });
  await page.locator('label.seg-opt', { hasText: /^Full doors$/ }).click();
  await expect(page.getByRole('radio', { name: 'Full doors' })).toBeChecked();
  await page.screenshot({ path: `${shotDir}/${info.project.name}-add.png`, fullPage: true });
  await page.getByRole('button', { name: 'Add stop' }).click();
  await expect(page.getByRole('heading', { name: 'Demo Test Fuel' })).toBeVisible();
  await expect(page.getByText(/Demo only: this stop exists in this tab only/)).toBeVisible();
  await expect(page.getByText('No crowd ratings yet')).toBeVisible();
  await expect(page.getByText('You added this stop and its original rating.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Stop not found' })).toBeVisible();
});

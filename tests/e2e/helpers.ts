import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

const style = readFileSync(new URL('./test-style.json', import.meta.url), 'utf8');

/** The test environment cannot reach the tile server, so serve a tiny offline style instead. */
export async function offlineMap(page: Page) {
  await page.route('https://tiles.openfreemap.org/**', (r) => r.fulfill({ contentType: 'application/json', body: style }));
}

export function trackRequests(page: Page) {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  return urls;
}

export const shotDir = 'test-results/screens';

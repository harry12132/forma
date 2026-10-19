import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const html = await readFile(new URL('../dist/index.html', import.meta.url));
const css = await readFile(new URL('../dist/style.css', import.meta.url));
const server = createServer((request, response) => {
  if (request.url === '/style.css') {
    response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
    response.end(css);
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByRole('heading', { name: 'The whole language. On display.' }).waitFor();

  for (const animation of ['fade-up', 'fade-down', 'fade-left', 'fade-right', 'fade', 'scale', 'zoom', 'blur']) {
    assert.ok(await page.locator(`[data-reveal="${animation}"]`).count() > 0, `missing ${animation} reveal demo`);
  }
  for (const hover of ['lift', 'glow', 'scale', 'tilt']) {
    assert.ok(await page.locator(`[data-hover="${hover}"]`).count() > 0, `missing ${hover} hover demo`);
  }
  for (const effect of ['reflection', 'aurora', 'border-glow']) {
    assert.ok(await page.locator(`.forma-effect-${effect}`).count() > 0, `missing ${effect} effect demo`);
  }

  const detailsTab = page.getByRole('tab', { name: 'Accessibility' });
  await detailsTab.click();
  await page.getByText('Tabs use ARIA roles, selected state, and keyboard navigation.').waitFor({ state: 'visible' });

  const accordionItem = page.locator('details').filter({ hasText: 'Are accordions native?' });
  await accordionItem.locator('summary').click();
  assert.equal(await accordionItem.evaluate(element => element.open), true);

  await page.getByRole('button', { name: 'Open modal preview' }).click();
  await page.locator('dialog.forma-dialog').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /close/i }).click();
  await page.locator('dialog.forma-dialog').waitFor({ state: 'hidden' });

  await page.getByText('The string condition is true because status is Ready.').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Mark explored' }).click();
  await page.getByText('The string condition is true because status is Ready.').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Mark ready' }).click();
  await page.getByText('The string condition is true because status is Ready.').waitFor({ state: 'visible' });

  const email = page.getByLabel('Email address');
  await email.fill('not-an-email');
  await page.getByRole('button', { name: 'Validate and preview submit' }).click();
  assert.equal(await email.evaluate(element => element.validity.valid), false);
  await email.fill('forma@example.com');
  await page.getByLabel('Send me occasional updates').check();
  await page.getByText("You're opted in for the demo preference. This is conditional content driven by checkbox state.").waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Validate and preview submit' }).click();
  await page.getByText('Success! Native validation passed. This was a client-side demo; no data was sent to a server.').waitFor({ state: 'visible' });

  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.getByLabel('Email address').isVisible(), true);
  assert.ok(await page.locator('.forma-grid').count() > 0);
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  assert.ok(dimensions.content <= dimensions.viewport + 1, `mobile horizontal overflow: ${JSON.stringify(dimensions)}`);

  console.log('Browser smoke checks passed: all reveal and hover presets, visual effects, tabs, accordion, modal, string conditions, native validation, checkbox state binding, form success, and mobile layout.');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}

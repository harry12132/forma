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
  await page.getByRole('heading', { name: 'Interfaces, with feeling.' }).waitFor();

  const detailsTab = page.getByRole('tab', { name: 'Tabs' });
  await detailsTab.click();
  await page.getByText('Switch between related views without leaving the page.').waitFor({ state: 'visible' });

  const accordionItem = page.locator('details').filter({ hasText: 'What is Forma?' });
  await accordionItem.locator('summary').click();
  assert.equal(await accordionItem.evaluate(element => element.open), true);

  await page.getByRole('button', { name: 'Preview a dialog' }).click();
  await page.locator('dialog.forma-dialog').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /close/i }).click();
  await page.locator('dialog.forma-dialog').waitFor({ state: 'hidden' });

  const email = page.getByLabel('Email address');
  await email.fill('not-an-email');
  await page.getByRole('button', { name: 'Preview submit' }).click();
  assert.equal(await email.evaluate(element => element.validity.valid), false);
  await email.fill('forma@example.com');
  await page.getByLabel('Send me occasional updates').check();
  await page.getByText('You can change this preference any time.').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Preview submit' }).click();
  await page.getByText('Success state shown. No data was sent to a server.').waitFor({ state: 'visible' });

  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.getByLabel('Email address').isVisible(), true);
  console.log('Browser smoke checks passed: tabs, accordion, modal, validation, state binding, conditional content, form success, and mobile visibility.');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}

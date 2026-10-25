import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import type { Verification } from '../src/types/index.js';

const arg = (key: string, fallback: string) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1]! : fallback;
const base = arg('--url', 'http://127.0.0.1:5173').replace(/\/+$/, '');
const output = resolve(arg('--output', '../docs/screenshots'));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 1 });
const report: Record<string, any> = { base, captured: new Date().toISOString(), examples: [], browserErrors: [] };
page.on('pageerror', error => report.browserErrors.push(error.message));
let id: string | undefined;
try {
  await page.goto(base);
  const health = await page.request.get(`${base}/api/health`);
  assert.equal(health.status(), 200);
  report.health = await health.json();
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Импорт', exact: true }).click();
  await page.getByLabel('Добавить к текущему проекту (сохранить существующие файлы)', { exact: true }).uncheck();
  const imported = page.waitForResponse(response => response.url().endsWith('/projects/parse') && response.status() === 201);
  await page.locator('input[type=file]').last().setInputFiles(['BigODemo.java', 'BigODemoTest.java'].map(file => fileURLToPath(new URL(`../examples/${file}`, import.meta.url))));
  const snapshot = await (await imported).json();
  id = snapshot.projectId;
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
  const analysis = await (await page.request.post(`${base}/api/projects/${id}/analyze`, { data: {} })).json();
  report.analysis = analysis;
  for (const [name, expected, filename] of [
    ['constant', 'O(1)', 'big-o-constant.png'], ['linear', 'O(n)', 'big-o-linear.png'],
    ['logarithmic', 'O(log(n))', 'big-o-logarithmic.png'], ['nLogN', 'O(n * log(n))', 'big-o-n-log-n.png'],
    ['quadratic', 'O(n^2)', 'big-o-quadratic.png'], ['pairsOptimized', 'O(1)', 'big-o-optimized.png'],
  ]) {
    const method = snapshot.graph.nodes.find((node: any) => node.data.title === name);
    assert.equal(analysis.complexity.find((entry: any) => entry.methodId === method.id).estimate, expected);
    await page.getByLabel('Метод схемы').selectOption(method.id);
    await expect(page.getByTestId('complexity-summary')).toContainText(expected!.replace(/\^2(?!\d)/g, '²').replace(/\^3(?!\d)/g, '³'));
    await page.getByRole('button', { name: 'Вписать в экран', exact: true }).click();
    await page.waitForTimeout(400); // React Flow fit animation is 300 ms.
    await page.screenshot({ path: resolve(output, filename!) });
    report.examples.push({ method: name, estimate: expected, screenshot: filename });
  }
  const quadratic = snapshot.graph.nodes.find((node: any) => node.data.title === 'quadratic');
  await page.getByLabel('Метод схемы').selectOption(quadratic.id);
  await expect(page.locator('.diagnostic-node').first()).toBeVisible();
  await page.getByRole('button', { name: 'К блоку', exact: true }).first().click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: resolve(output, 'diagnostics-graph.png') });
  await page.getByRole('button', { name: 'К коду', exact: true }).first().click();
  await expect(page.locator('.monaco-editor .diagnostic-line-medium').first()).toBeVisible();
  await page.screenshot({ path: resolve(output, 'diagnostics-code.png') });
  await page.getByRole('button', { name: 'Блок-схема', exact: true }).click();
  await page.getByRole('button', { name: 'Результат тестов', exact: true }).click();
  await page.getByLabel('Ввод программы', { exact: true }).fill('16');
  const verified = page.waitForResponse(response => response.url().endsWith('/verify'));
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const response = await verified;
  assert.equal(response.status(), 200, await response.text());
  report.verification = await response.json() as Verification;
  assert.equal(report.verification.current.tests.status, 'passed');
  assert.match(report.verification.current.tests.report, /3 tests successful/);
  assert.equal(report.verification.comparison.status, 'matched_on_inputs');
  await page.getByRole('button', { name: 'Результат тестов', exact: true }).click();
  await expect(page.getByText('JUnit 5 (3 tests found)', { exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(output, 'verification.png') });
  assert.deepEqual(report.browserErrors, []);
  report.completed = new Date().toISOString();
  console.log(JSON.stringify(report.examples));
} catch (error) {
  report.failure = String(error);
  throw error;
} finally {
  await writeFile(resolve(output, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
  if (id) await page.request.delete(`${base}/api/projects/${id}`).catch(() => {});
  await browser.close();
}

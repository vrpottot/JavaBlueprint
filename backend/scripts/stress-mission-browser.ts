import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import type { Verification } from '../src/types/index.js';
import type { graph } from '../src/services/graph.js';

type ProjectSnapshot = { projectId: string; revision: number; graph: ReturnType<typeof graph> };

// Manual UI audit of the large fixture; does not run in CI.
const argument = (flag: string) => process.argv[process.argv.indexOf(flag) + 1];
const base = process.argv.includes('--url') ? argument('--url')! : 'http://127.0.0.1:5173';
const output = process.argv.includes('--output') ? resolve(argument('--output')!) : await mkdtemp(join(tmpdir(), 'javascope-mission-ui-'));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(30000);
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
let projectId: string | undefined;
const report: Record<string, unknown> = { base, started: new Date().toISOString(), errors };
const scopes: unknown[] = [];
report.scopes = scopes;

async function geometry() {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node')).map(node => ({
      id: node.dataset.id, text: node.textContent?.slice(0, 120), box: node.getBoundingClientRect(),
    }));
    const overlaps = [];
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const first = nodes[i]!, second = nodes[j]!;
      if (Math.min(first.box.right, second.box.right) - Math.max(first.box.left, second.box.left) > 2 &&
          Math.min(first.box.bottom, second.box.bottom) - Math.max(first.box.top, second.box.top) > 2) overlaps.push([first.text, second.text]);
    }
    return { nodes: nodes.length, overlaps };
  });
}

try {
  await page.goto(base);
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled({ timeout: 30000 });
  await page.getByRole('button', { name: 'Импорт', exact: true }).click();
  await page.getByLabel('Добавить к текущему проекту (сохранить существующие файлы)', { exact: true }).uncheck();
  const imported = page.waitForResponse(response => response.url().endsWith('/projects/parse') && response.status() === 201);
  await page.locator('input[type=file]').last().setInputFiles(['MissionControl.java', 'MissionControlTest.java'].map(file =>
    fileURLToPath(new URL(`../examples/mission-control/${file}`, import.meta.url))));
  const snapshot = await (await imported).json() as ProjectSnapshot;
  projectId = snapshot.projectId;
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
  const options = await page.getByLabel('Метод схемы').locator('option').evaluateAll(nodes => (nodes as HTMLOptionElement[])
    .filter(node => node.value !== 'all' && node.value !== 'members').map(node => ({ id: node.value, title: node.textContent })));
  assert.equal(options.length, 100, '85 methods, 11 constructors and 4 compact record constructors');
  for (const option of options) {
    await page.getByLabel('Метод схемы').selectOption(option.id);
    await page.locator(`.react-flow__node[data-id="${option.id}"]`).waitFor();
    const result = await geometry();
    scopes.push({ title: option.title, ...result });
  }
  const overlapping = scopes.filter(value => (value as Awaited<ReturnType<typeof geometry>>).overlaps.length > 0);
  report.overlappingScopes = overlapping;
  const compact = snapshot.graph.nodes.find(node => node.data.astKind === 'CompactConstructorDeclaration' && node.data.title === 'Config')!;
  assert.ok(compact);
  await page.getByLabel('Метод схемы').selectOption(compact.id);
  await page.getByRole('button', { name: 'Вписать в экран', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Ограничения схемы' }).click();
  await expect(page.getByText('Компактный конструктор record:', { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: join(output, 'compact-constructor.png') });
  const validation = page.locator('.react-flow__node-conditionNode').filter({ hasText: 'size < 0 || size > MAX_MISSIONS' });
  await validation.dblclick();
  await page.getByRole('dialog').getByLabel('Условие Java', { exact: true }).fill('size > MAX_MISSIONS || size < 0');
  const transformed = page.waitForResponse(response => response.url().endsWith('/transform'));
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить', exact: true }).click();
  const response = await transformed;
  assert.equal(response.status(), 200, await response.text());
  const changed = await response.json() as ProjectSnapshot;
  assert.equal(changed.revision, 1);
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Результат тестов', exact: true }).click();
  await page.getByLabel('Ввод программы', { exact: true }).fill('');
  const verified = page.waitForResponse(result => result.url().endsWith('/verify'), { timeout: 120000 });
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const verificationResponse = await verified;
  assert.equal(verificationResponse.status(), 200, await verificationResponse.text());
  const verification = await verificationResponse.json() as Verification;
  report.verification = verification;
  assert.equal(verification.current.compilation.exitCode, 0, verification.current.compilation.stderr);
  assert.equal(verification.current.tests.status, 'passed');
  assert.equal(verification.comparison.status, 'matched_on_inputs');
  assert.match(verification.current.tests.report ?? '', /16 tests successful/);
  await expect(page.getByText('JUnit 5 (16 tests found)', { exact: true })).toBeVisible();
  await page.screenshot({ path: join(output, 'java-and-junit.png') });
  await page.locator('.react-flow__node-methodNode').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Открыть Java-код', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Editor content', exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('Config {');
  report.sourceNavigation = true;
  await page.getByRole('button', { name: 'Блок-схема', exact: true }).click();
  await page.getByRole('treeitem', { name: /MissionControlTest\.java$/ }).click();
  const testIds = new Set(snapshot.graph.nodes.filter(node => node.data.source.file === 'MissionControlTest.java').map(node => node.id));
  const visibleIds = await page.locator('.react-flow__node').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.id));
  assert.ok(visibleIds.length > 0 && visibleIds.every(id => id && testIds.has(id)));
  report.fileNavigation = true;
  await page.getByRole('treeitem', { name: /MissionControl\.java$/ }).click();
  const shortest = options.find(option => option.title?.startsWith('shortest —'))!;
  await page.getByLabel('Метод схемы').selectOption(shortest.id);
  await page.getByRole('button', { name: 'Вписать в экран', exact: true }).click();
  await page.screenshot({ path: join(output, 'shortest-path.png') });
  report.finished = new Date().toISOString();
  assert.deepEqual(overlapping, [], 'some method scopes contain overlapping blocks');
  assert.deepEqual(errors, [], 'browser errors');
  console.log(JSON.stringify({ output, scopes: options.length, overlappingScopes: overlapping.length,
    compilation: verification.current.compilation.exitCode, junit: verification.current.tests.status,
    comparison: verification.comparison.status, sourceNavigation: true, fileNavigation: true }));
} catch (error) {
  report.failure = String(error);
  await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await writeFile(join(output, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
  if (projectId) await page.request.delete(`${base}/api/projects/${projectId}`).catch(() => {});
  await browser.close();
}

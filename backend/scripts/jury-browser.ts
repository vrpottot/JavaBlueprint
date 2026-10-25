import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import type { EngineResult, Verification } from '../src/types/index.js';
import type { graph } from '../src/services/graph.js';
type ProjectSnapshot = { projectId: string; graph: ReturnType<typeof graph>; files: EngineResult['files']; containers: EngineResult['containers'] };

// A jury workflow against a frozen deployed revision; no production source changes.
const arg = (flag: string, fallback: string) => process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1]! : fallback;
const base = arg('--url', 'http://127.0.0.1:5173');
const output = resolve(arg('--output', '/tmp/javascope-jury/browser'));
const selected = arg('--case', 'all');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const scenarios = [{ name: 'ClearingHouse', folder: 'clearing', method: 'inversionCount' },
  { name: 'QueryForge', folder: 'query', method: 'runningTotal' }, { name: 'TransitGrid', folder: 'transit', method: 'peak' }];
try {
  for (const scenario of scenarios.filter(item => selected === 'all' || item.folder === selected)) {
    const destination = resolve(output, scenario.folder);
    await mkdir(destination, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.setDefaultTimeout(45000);
    const report: Record<string, any> = { base, started: new Date().toISOString(), scopes: [], errors: [], warnings: [], checks: [] };
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', event => { if (event.type() === 'warning' && event.text().includes('React Flow')) report.warnings.push(event.text()); });
    let projectId: string | undefined;
    const save = () => writeFile(resolve(destination, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
    const check = async (name: string, run: () => Promise<void>) => {
      const begin = performance.now();
      try { await run(); report.checks.push({ name, passed: true, ms: Math.round(performance.now() - begin) }); }
      catch (error) { report.checks.push({ name, passed: false, error: String(error) }); await page.screenshot({ path: resolve(destination, `failure-${report.checks.length}.png`) }).catch(() => {}); }
      await save();
    };
    try {
      await page.goto(base);
      report.health = await (await page.request.get(`${base}/api/health`)).json();
      await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Импорт', exact: true }).click();
      await page.getByLabel('Добавить к текущему проекту (сохранить существующие файлы)', { exact: true }).uncheck();
      const imported = page.waitForResponse(response => response.url().endsWith('/projects/parse') && response.status() === 201);
      const started = performance.now();
      await page.locator('input[type=file]').last().setInputFiles([`${scenario.name}.java`, `${scenario.name}Test.java`]
        .map(file => fileURLToPath(new URL(`../examples/jury/${scenario.folder}/${file}`, import.meta.url))));
      const snapshot = await (await imported).json() as ProjectSnapshot;
      projectId = snapshot.projectId;
      report.importMs = Math.round(performance.now() - started);
      const options = await page.getByLabel('Метод схемы').locator('option').evaluateAll(nodes => (nodes as HTMLOptionElement[])
        .filter(node => node.value !== 'all' && node.value !== 'members').map(node => ({ id: node.value, title: node.textContent })));
      for (const option of options) {
        await page.getByLabel('Метод схемы').selectOption(option.id);
        await page.locator(`.react-flow__node[data-id="${option.id}"]`).waitFor();
        await page.evaluate(() => new Promise(requestAnimationFrame));
        const geometry = await page.evaluate(() => {
          const nodes = Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node')).map(node => ({
            id: node.dataset.id, text: node.textContent?.slice(0, 100), box: node.getBoundingClientRect(),
          }));
          const overlaps: unknown[] = [];
          for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i]!, b = nodes[j]!;
            if (Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left) > 2 &&
                Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top) > 2) overlaps.push([a.text, b.text]);
          }
          return { nodes: nodes.length, overlaps };
        });
        report.scopes.push({ title: option.title, ...geometry });
      }
      report.overlappingScopes = report.scopes.filter((scope: any) => scope.overlaps.length);
      await check('all method scopes have no overlapping blocks', async () => assert.deepEqual(report.overlappingScopes, []));
      const method = snapshot.graph.nodes.find(node => node.data.title === scenario.method && node.data.blockType === 'method')!;
      await page.getByLabel('Метод схемы').selectOption(method.id);
      await page.getByRole('button', { name: 'Вписать в экран', exact: true }).click();
      await page.screenshot({ path: resolve(destination, 'method.png') });
      await check('Java export preserves exact source bytes', async () => {
        const download = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Экспорт .java', exact: true }).click();
        const file = await download;
        const path = resolve(destination, file.suggestedFilename());
        await file.saveAs(path);
        assert.equal(await readFile(path, 'utf8'), snapshot.files.find(value => value.path === `${scenario.name}.java`)!.content);
      });
      await check('PNG download has valid format and dimensions', async () => {
        const download = page.waitForEvent('download', { timeout: 20000 });
        await page.getByRole('button', { name: 'Экспорт в PNG', exact: true }).click();
        const file = await download;
        const path = resolve(destination, 'export.png');
        await file.saveAs(path);
        const bytes = await readFile(path);
        assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        report.png = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length };
        assert.ok(report.png.width > 100 && report.png.height > 100);
      });
      await check('method palette adds and deletes a real method', async () => {
        await page.getByRole('button', { name: 'Добавить блок Метод', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Добавить метод', exact: true });
        const owner = snapshot.containers!.find(container => container.name === scenario.name)!;
        await dialog.getByLabel('Класс и файл', { exact: true }).selectOption(owner.id);
        await dialog.getByLabel('Сигнатура метода', { exact: true }).fill('public static int juryMarker()');
        await dialog.getByLabel('Тело метода', { exact: true }).fill('return 31;');
        const created = page.waitForResponse(response => response.url().endsWith('/transform'));
        await dialog.getByRole('button', { name: 'Добавить метод', exact: true }).click();
        const response = await created;
        assert.equal(response.status(), 200, await response.text());
        const added = await response.json();
        assert.match(added.files.find((file: any) => file.path === `${scenario.name}.java`).content, /juryMarker/);
        const marker = page.locator(`.react-flow__node[data-id="${added.changes[0].nodeId}"]`);
        await marker.click({ button: 'right' });
        const deleted = page.waitForResponse(response => response.url().endsWith('/transform'));
        await page.getByRole('menuitem', { name: 'Удалить блок', exact: true }).click();
        assert.equal((await deleted).status(), 200);
      });
      await page.getByLabel('Метод схемы').selectOption(method.id);
      await check('source navigation opens the selected method', async () => {
        await page.locator(`.react-flow__node[data-id="${method.id}"]`).click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Открыть Java-код', exact: true }).click();
        await expect(page.getByRole('textbox', { name: 'Editor content', exact: true })).toBeVisible();
        await expect(page.locator('.monaco-editor .view-lines')).toContainText(scenario.method);
        await page.getByRole('button', { name: 'Блок-схема', exact: true }).click();
      });
      await check('real UI compiles, runs, compares and shows 15 JUnit tests', async () => {
        await page.getByRole('button', { name: 'Результат тестов', exact: true }).click();
        await page.getByLabel('Ввод программы', { exact: true }).fill('12 7');
        const verified = page.waitForResponse(response => response.url().endsWith('/verify'), { timeout: 120000 });
        await page.getByRole('button', { name: 'Run', exact: true }).click();
        const response = await verified;
        assert.equal(response.status(), 200, await response.text());
        const verification = await response.json() as Verification;
        report.verification = verification;
        assert.equal(verification.current.compilation.exitCode, 0);
        assert.equal(verification.current.tests.status, 'passed');
        assert.match(verification.current.tests.report ?? '', /15 tests successful/);
        assert.equal(verification.comparison.status, 'matched_on_inputs');
        await page.getByRole('button', { name: 'Результат тестов', exact: true }).click();
        await expect(page.getByText('JUnit 5 (15 tests found)', { exact: true })).toBeVisible();
        await page.screenshot({ path: resolve(destination, 'junit.png') });
      });
      await check('test file scopes do not include main source nodes', async () => {
        await page.getByRole('treeitem', { name: new RegExp(`${scenario.name}Test\\.java$`) }).click();
        const allowed = new Set(snapshot.graph.nodes.filter(node => node.data.source?.file === `${scenario.name}Test.java`).map(node => node.id));
        const ids = await page.locator('.react-flow__node').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.id));
        assert.ok(ids.length > 0 && ids.every(id => id && allowed.has(id)));
      });
      await check('no browser exceptions or missing React Flow handles', async () => { assert.deepEqual(report.errors, []); assert.deepEqual(report.warnings, []); });
    } catch (error) {
      report.failure = String(error);
      await page.screenshot({ path: resolve(destination, 'fatal.png') }).catch(() => {});
    } finally {
      report.finished = new Date().toISOString();
      await save();
      if (projectId) await page.request.delete(`${base}/api/projects/${projectId}`).catch(() => {});
      await page.close();
    }
    console.log(JSON.stringify({ scenario: scenario.name, scopes: report.scopes.length, checks: report.checks, failure: report.failure }));
    if (report.failure || report.checks.some((item: any) => !item.passed)) process.exitCode = 1;
  }
} finally { await browser.close(); }

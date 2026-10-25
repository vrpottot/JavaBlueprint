import { test, expect } from '@playwright/test';

test('file and method navigation keeps graphs separate and case edits change real execution', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled({ timeout: 20000 });
  await page.getByRole('button', { name: 'Импорт', exact: true }).click();
  await page.getByLabel('Добавить к текущему проекту (сохранить существующие файлы)', { exact: true }).uncheck();
  const imported = page.waitForResponse(r => r.url().endsWith('/projects/parse') && r.status() === 201);
  await page.locator('input[type=file]').last().setInputFiles([
    { name: 'Main.java', mimeType: 'text/plain', buffer: Buffer.from('public class Main { static int discount(int x) { int p=0; switch(x) { case 0: p=6; break; default: p=1; } return p; } public static void main(String[] args) { System.out.println(discount(0)); } }') },
    { name: 'Tools.java', mimeType: 'text/plain', buffer: Buffer.from('class Tools { int linear(int[] a) { int sum=0; for(int value:a) sum+=value; return sum; } }') },
  ]);
  const project = await (await imported).json();
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
  const method = project.graph.nodes.find((n: any) => n.data.title === 'discount');
  await page.getByLabel('Метод схемы').selectOption(method.id);
  await page.getByRole('button', { name: 'Вписать в экран', exact: true }).click();
  const statement = page.locator('.react-flow__node-operationNode').filter({ hasText: 'p = 6;' });
  await expect(statement).toBeInViewport();
  await statement.dblclick();
  await page.getByRole('dialog').getByLabel('Java-инструкция целиком', { exact: true }).fill('p = 8;');
  const edited = page.waitForResponse(r => r.url().endsWith('/transform'));
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить', exact: true }).click();
  const response = await edited;
  expect(response.status(), await response.text()).toBe(200);
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('treeitem', { name: /Tools\.java$/ }).click();
  await expect(page.locator('.react-flow__node-methodNode')).toHaveCount(1);
  await expect(page.locator('.react-flow__node-methodNode')).toContainText('linear');
  await expect(page.locator('.react-flow__node')).not.toContainText(['Main.java']);
  await expect(page.locator('.react-flow__node-loopNode')).toContainText('int value : a');
  await page.getByRole('treeitem', { name: /Main\.java$/ }).click();
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
  const verified = page.waitForResponse(r => r.url().endsWith('/verify'));
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const java = await (await verified).json();
  expect(java.current.compilation.exitCode).toBe(0);
  expect(java.current.runs[0].stdout).toBe('8\n');
  expect(java.comparison.status).toBe('different');
});

test('invalid source retains the last graph, displays file diagnostics and recovers after correction', async ({ page }) => {
  const parsed = page.waitForResponse(r => r.url().endsWith('/projects/parse') && r.status() === 201);
  await page.goto('/');
  const project = await (await parsed).json();
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Код Java', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Editor content', exact: true });
  await editor.waitFor({ timeout: 30000 });
  // Monaco paints source lines over its native EditContext input; focus the input directly.
  await editor.focus();
  await editor.press('Control+KeyA');
  const failed = page.waitForResponse(r => r.url().endsWith('/sources') && r.status() === 422, { timeout: 15000 });
  await page.keyboard.insertText('public class Main { int broken( { }');
  await failed;
  await expect(page.getByRole('alert').first()).toContainText('Main.java:');
  await expect(page.getByRole('status').filter({ hasText: 'последняя успешно разобранная версия' })).toBeVisible();
  const unchanged = await page.request.get(`/api/projects/${project.projectId}/graph`);
  expect((await unchanged.json()).revision).toBe(0);
  await editor.focus();
  await editor.press('Control+KeyA');
  const restored = page.waitForResponse(r => r.url().endsWith('/sources') && r.status() === 200, { timeout: 15000 });
  await page.keyboard.insertText(project.files[0].content);
  await restored;
  await expect(page.getByRole('status').filter({ hasText: 'последняя успешно разобранная версия' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Блок-схема', exact: true }).click();
  await expect(page.locator('.react-flow__node-methodNode').filter({ hasText: /main/ })).toHaveCount(1);
});

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test('real UI imports files, edits the AST, verifies Java and shows JUnit results', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Метод схемы').selectOption(await page.getByLabel('Метод схемы').locator('option').filter({ hasText: /^classify —/ }).getAttribute('value') as string);
  const branch = page.locator('.react-flow__node-conditionNode').first();
  await expect(branch).toBeVisible({ timeout: 20000 });
  await expect(branch).toContainText('value > 0');
  await page.getByRole('button', { name: 'Сводка', exact: true }).click();
  await expect(page.getByText('classify: O(1)', { exact: false })).toBeVisible();
  await branch.dblclick();
  const dialog = page.getByRole('dialog');
  await dialog.locator('textarea').fill('value >= 1');
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.locator('.react-flow__node-conditionNode').first()).toContainText('value >= 1');

  await page.getByRole('button', { name: 'Импорт', exact: true }).click();
  await page.getByLabel('Добавить к текущему проекту (сохранить существующие файлы)', { exact: true }).uncheck();
  const imported = page.waitForResponse(r => r.url().endsWith('/projects/parse') && r.status() === 201);
  await page.locator('input[type=file]').last().setInputFiles([
    fileURLToPath(new URL('../../examples/Main.java', import.meta.url)),
    fileURLToPath(new URL('../../examples/MainTest.java', import.meta.url)),
  ]);
  await imported;
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
  const verification = page.waitForResponse(r => r.url().endsWith('/verify'));
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Компиляция...' })).toBeVisible();
  const result = await verification;
  expect(result.status(), await result.text()).toBe(200);
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled({ timeout: 90000 });
  await page.getByRole('button', { name: 'Результат тестов', exact: true }).click();
  await expect(page.getByText('Все тесты пройдены')).toBeVisible();
  await expect(page.getByText('JUnit 5 (3 tests found)')).toBeVisible();
  await page.getByRole('button', { name: 'Консоль', exact: true }).click();
  await expect(page.getByText(/javac: exit=0/)).toBeVisible();
  await expect(page.getByText(/Full program equivalence is not proven/)).toBeVisible();
  expect(errors).toEqual([]);
});

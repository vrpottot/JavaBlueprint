import { test, expect } from '@playwright/test';

test('method palette creates, validates, edits, copies and deletes real Java methods', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.locator('.react-flow__node-methodNode').first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Импорт', exact: true }).click();
  await page.getByLabel('Добавить к текущему проекту (сохранить существующие файлы)', { exact: true }).uncheck();
  const imported = page.waitForResponse(r => r.url().endsWith('/projects/parse') && r.status() === 201);
  await page.locator('input[type=file]').last().setInputFiles([
    { name: 'Main.java', mimeType: 'text/plain', buffer: Buffer.from('public class Main { public static void main(String[] args) { System.out.println(Worker.square(3)); } }') },
    { name: 'Worker.java', mimeType: 'text/plain', buffer: Buffer.from('public class Worker {}') },
    { name: 'WorkerTest.java', mimeType: 'text/plain', buffer: Buffer.from('import org.junit.jupiter.api.Test; import static org.junit.jupiter.api.Assertions.*; public class WorkerTest { @Test void squares() { assertEquals(9, Worker.square(3)); assertEquals(16, Worker.square(-4)); } }') },
  ]);
  const original = await (await imported).json();
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();

  // An empty class is a valid target even without any existing method node.
  const palette = page.getByRole('button', { name: 'Добавить блок Метод', exact: true });
  await palette.focus();
  await palette.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Добавить метод', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Сигнатура метода', { exact: true })).toBeFocused();
  await dialog.getByLabel('Класс и файл', { exact: true }).selectOption(original.containers.find((c: any) => c.name === 'Worker').id);
  await dialog.getByLabel('Сигнатура метода', { exact: true }).fill('public static int square(int value)');
  await dialog.getByLabel('Тело метода', { exact: true }).fill('return value + value;');
  await page.screenshot({ path: testInfo.outputPath('method-editor-light.png') });
  const preview = page.waitForResponse(r => r.url().endsWith('/transform/preview'));
  await dialog.getByRole('button', { name: 'Проверить синтаксис', exact: true }).click();
  expect((await preview).status()).toBe(200);
  await expect(dialog.getByRole('status')).toContainText('Синтаксис корректен');
  const unchanged = await page.request.get(`/api/projects/${original.projectId}/graph`);
  expect((await unchanged.json()).revision).toBe(0);
  await expect(page.locator('.react-flow__node-methodNode').filter({ has: page.getByText('square', { exact: true }) })).toHaveCount(0);

  const created = page.waitForResponse(r => r.url().endsWith('/transform'));
  await dialog.getByRole('button', { name: 'Добавить метод', exact: true }).click();
  const added = await (await created).json();
  const methodId = added.changes[0].nodeId;
  const method = page.locator(`.react-flow__node[data-id="${methodId}"]`);
  await expect(dialog).toBeHidden();
  await expect(method).toBeInViewport();
  expect(added.files.find((f: any) => f.path === 'Worker.java').content).toContain('return value + value;');
  expect(added.files.find((f: any) => f.path === 'Main.java').content).toBe(original.files.find((f: any) => f.path === 'Main.java').content);

  await method.dblclick();
  const edit = page.getByRole('dialog', { name: 'Редактировать метод', exact: true });
  await expect(edit.getByLabel('Класс и файл', { exact: true })).toBeDisabled();
  await expect(edit.getByLabel('Тело метода', { exact: true })).toHaveValue('return value + value;');
  await edit.getByLabel('Тело метода', { exact: true }).fill('return value * value;');
  const updated = page.waitForResponse(r => r.url().endsWith('/transform'));
  await edit.getByLabel('Тело метода', { exact: true }).press('Control+Enter');
  const edited = await (await updated).json();
  expect(edited.changes[0].nodeId).toBe(methodId);
  await expect(edit).toBeHidden();
  await expect(method).toBeInViewport();

  // A conflicting signature leaves the form open and the stored project intact.
  await palette.click();
  await dialog.getByLabel('Сигнатура метода', { exact: true }).fill('public static int square(int other)');
  await dialog.getByLabel('Тело метода', { exact: true }).fill('return other;');
  const rejected = page.waitForResponse(r => r.url().endsWith('/transform'));
  await dialog.getByRole('button', { name: 'Добавить метод', exact: true }).click();
  expect((await rejected).status()).toBe(422);
  await expect(dialog.getByRole('alert')).toContainText('уже существует');
  await expect(dialog.getByLabel('Тело метода', { exact: true })).toHaveValue('return other;');
  await expect(dialog.getByRole('alert')).toBeFocused();
  await dialog.getByRole('alert').press('Escape');
  await expect(dialog).toBeHidden();

  await method.click({ button: 'right' });
  const duplicated = page.waitForResponse(r => r.url().endsWith('/transform'));
  await page.getByText('Дублировать', { exact: true }).click();
  const copy = await (await duplicated).json();
  const copyId = copy.changes[0].nodeId;
  const copyNode = page.locator(`.react-flow__node[data-id="${copyId}"]`);
  await expect(copyNode).toContainText('squareCopy');
  await expect(copyNode).toBeInViewport();
  await copyNode.click({ button: 'right' });
  const deleted = page.waitForResponse(r => r.url().endsWith('/transform'));
  await page.getByText('Удалить блок', { exact: true }).click();
  const result = await (await deleted).json();
  expect(result.revision).toBe(4);
  await expect(copyNode).toHaveCount(0);
  expect(result.files.find((f: any) => f.path === 'Worker.java').content).toContain('return value * value;');

  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
  const verified = page.waitForResponse(r => r.url().endsWith('/verify'));
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const verification = await verified;
  expect(verification.status(), await verification.text()).toBe(200);
  const java = await verification.json();
  expect(java.current.compilation.exitCode).toBe(0);
  expect(java.current.runs[0].stdout.trim()).toBe('9');
  expect(java.current.tests.status).toBe('passed');
  await page.getByRole('button', { name: 'Результат тестов', exact: true }).click();
  await expect(page.getByText('Все тесты пройдены')).toBeVisible();
  expect(errors).toEqual([]);
});

test('dragging the method block supports interface declarations and keyboard navigation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled({ timeout: 20000 });
  await page.getByRole('button', { name: 'Импорт', exact: true }).click();
  await page.getByLabel('Добавить к текущему проекту (сохранить существующие файлы)', { exact: true }).uncheck();
  const imported = page.waitForResponse(r => r.url().endsWith('/projects/parse') && r.status() === 201);
  await page.locator('input[type=file]').last().setInputFiles([
    { name: 'Worker.java', mimeType: 'text/plain', buffer: Buffer.from('public interface Worker {}') },
    { name: 'Main.java', mimeType: 'text/plain', buffer: Buffer.from('class Main {}') },
  ]);
  const project = await (await imported).json();
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();

  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await page.getByRole('button', { name: 'Добавить блок Метод', exact: true }).dispatchEvent('dragstart', { dataTransfer });
  const canvas = page.locator('.react-flow');
  const bounds = (await canvas.boundingBox())!;
  await canvas.dispatchEvent('drop', { dataTransfer, clientX: bounds.x + 200, clientY: bounds.y + 200 });
  const dialog = page.getByRole('dialog', { name: 'Добавить метод', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Сигнатура метода', { exact: true })).toBeFocused();
  await dialog.getByLabel('Класс и файл', { exact: true }).selectOption(project.containers.find((c: any) => c.name === 'Worker').id);
  await dialog.getByLabel('Сигнатура метода', { exact: true }).press('Shift+Tab');
  await expect(dialog.getByLabel('Класс и файл', { exact: true })).toBeFocused();
  await dialog.getByLabel('Класс и файл', { exact: true }).press('Shift+Tab');
  await dialog.getByRole('button', { name: 'Закрыть редактор метода', exact: true }).press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Добавить метод', exact: true })).toBeFocused();
  await dialog.getByLabel('Сигнатура метода', { exact: true }).fill('void execute()');
  await dialog.getByRole('checkbox').check();
  await expect(dialog.getByLabel('Тело метода', { exact: true })).toHaveCount(0);
  const created = page.waitForResponse(r => r.url().endsWith('/transform'));
  await dialog.getByRole('button', { name: 'Добавить метод', exact: true }).click();
  const response = await created;
  expect(response.status(), await response.text()).toBe(200);
  const result = await response.json();
  const id = result.changes[0].nodeId;
  const method = page.locator(`.react-flow__node[data-id="${id}"]`);
  await expect(method).toBeInViewport();
  expect(result.graph.nodes.find((n: any) => n.id === id).data.method.hasBody).toBe(false);
  expect(result.files.find((f: any) => f.path === 'Worker.java').content).toContain('void execute();');
  expect(result.files.find((f: any) => f.path === 'Main.java').content).toBe('class Main {}');

  await method.dblclick();
  const edit = page.getByRole('dialog', { name: 'Редактировать метод', exact: true });
  await expect(edit.getByRole('checkbox')).toBeChecked();
  await edit.getByLabel('Сигнатура метода', { exact: true }).fill('default int count()');
  await edit.getByRole('checkbox').uncheck();
  await edit.getByLabel('Тело метода', { exact: true }).fill('return 1;');
  await page.screenshot({ path: testInfo.outputPath('method-editor-dark.png') });
  const updated = page.waitForResponse(r => r.url().endsWith('/transform'));
  await edit.getByRole('button', { name: 'Сохранить метод', exact: true }).click();
  const saved = await (await updated).json();
  expect(saved.changes[0].nodeId).toBe(id);
  expect(saved.graph.edges.some((e: any) => e.source === id)).toBe(true);
  await expect(method).toContainText('count');
});

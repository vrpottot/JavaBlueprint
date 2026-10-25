import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const at = process.argv.indexOf('--url');
const base = at >= 0 ? process.argv[at + 1]! : 'http://127.0.0.1:5173';
const output = '/tmp/javascope-jury/png';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
try {
  await page.goto(base);
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled({ timeout: 30000 });
  const option = await page.getByLabel('Метод схемы').locator('option').filter({ hasText: /^main —/ }).getAttribute('value');
  await page.getByLabel('Метод схемы').selectOption(option!);
  await page.getByRole('button', { name: 'Вписать в экран', exact: true }).click();
  const edges = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node')).map(node => {
      const match = node.style.transform.match(/translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/)!;
      return { x: Number(match[1]), y: Number(match[2]) };
    });
    const minX = Math.min(...nodes.map(node => node.x)), minY = Math.min(...nodes.map(node => node.y));
    return Array.from(document.querySelectorAll<SVGPathElement>('.react-flow__edge-path')).map(path => ({
      exception: !!path.style.stroke, stroke: getComputedStyle(path).stroke,
      points: [.3, .5, .7].map(fraction => {
        const point = path.getPointAtLength(path.getTotalLength() * fraction);
        return { x: Math.round((point.x - minX + 70) * 2), y: Math.round((point.y - minY + 70) * 2) };
      }),
    }));
  });
  await page.screenshot({ path: resolve(output, 'browser.png') });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт в PNG', exact: true }).click();
  await (await download).saveAs(resolve(output, 'export.png'));
  const data = await readFile(resolve(output, 'export.png'));
  const measured = await page.evaluate(async ({ png, edges }) => {
    const image = new Image();
    image.src = png;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return edges.map(edge => ({ ...edge, pixels: edge.points.map(point => {
      const bytes = context.getImageData(Math.max(0, point.x - 2), Math.max(0, point.y - 2), 5, 5).data;
      let colored = 0;
      for (let at = 0; at < bytes.length; at += 4) if (Math.max(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!) - Math.min(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!) > 50) colored++;
      return colored;
    }) }));
  }, { png: `data:image/png;base64,${data.toString('base64')}`, edges });
  const normal = measured.filter(edge => !edge.exception);
  const missing = normal.filter(edge => edge.pixels.every(count => count === 0));
  const report = { base, normalEdges: normal.length, missingEdges: missing.length, measured };
  await writeFile(resolve(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (missing.length) process.exitCode = 1;
} finally { await browser.close(); }

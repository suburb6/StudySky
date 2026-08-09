import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('the lazy production scanner corrects a page in Chromium', async ({ page }) => {
  const manifest = JSON.parse(
    await readFile('.svelte-kit/output/client/.vite/manifest.json', 'utf8')
  ) as Record<string, { file: string }>;
  const scannerPath = `/${manifest['src/lib/client/document-scanner.ts'].file}`;

  await page.goto('/health');
  const result = await page.evaluate(async (modulePath) => {
    const scanner = (await import(modulePath)) as {
      autoCorrectDocument(file: File): Promise<File>;
    };
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 1000;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#777777';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#ffffff';
    context.strokeStyle = '#151515';
    context.lineWidth = 10;
    context.beginPath();
    context.moveTo(105, 90);
    context.lineTo(710, 125);
    context.lineTo(680, 915);
    context.lineTo(80, 860);
    context.closePath();
    context.fill();
    context.stroke();
    context.fillStyle = '#181818';
    context.font = '42px sans-serif';
    context.fillText('StudySky notes', 180, 260);
    const source = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not create test image.'))),
        'image/png'
      )
    );
    const corrected = await scanner.autoCorrectDocument(
      new File([source], 'browser-page.png', { type: 'image/png' })
    );
    const bitmap = await createImageBitmap(corrected);
    const value = {
      type: corrected.type,
      name: corrected.name,
      width: bitmap.width,
      height: bitmap.height
    };
    bitmap.close();
    return value;
  }, scannerPath);

  expect(result.type).toBe('image/jpeg');
  expect(result.name).toBe('browser-page-corrected.jpg');
  expect(result.width).toBeGreaterThan(500);
  expect(result.height).toBeGreaterThan(700);
});

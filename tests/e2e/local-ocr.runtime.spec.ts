import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('the isolated OCR worker starts under the strict page CSP', async ({ page }) => {
  test.setTimeout(120_000);
  const manifest = JSON.parse(
    await readFile('.svelte-kit/output/client/.vite/manifest.json', 'utf8')
  ) as Record<string, { file: string }>;
  const runnerPath = `/${manifest['src/lib/client/local-ocr-runner.ts'].file}`;
  await page.route(/\/api\/ocr-models\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/x-tar',
      body: Buffer.alloc(1_024)
    })
  );

  await page.goto('/health');
  const message = await page.evaluate(async (modulePath) => {
    const module = (await import(modulePath)) as {
      createLocalOcrRunner(): Promise<{ dispose(): Promise<void> }>;
    };
    try {
      const runner = await module.createLocalOcrRunner();
      await runner.dispose();
      return 'unexpected success';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, runnerPath);

  expect(message).toMatch(/inference\.onnx.*tar archive/i);
});

test('the pinned student reading modes complete local OCR', async ({ page }) => {
  test.skip(
    process.env.E2E_FULL_OCR !== 'true',
    'Set E2E_FULL_OCR=true for the network model test.'
  );
  test.setTimeout(180_000);
  const manifest = JSON.parse(
    await readFile('.svelte-kit/output/client/.vite/manifest.json', 'utf8')
  ) as Record<string, { file: string }>;
  const runnerPath = `/${manifest['src/lib/client/local-ocr-runner.ts'].file}`;
  const upstream = {
    'PP-OCRv5_mobile_det.tar':
      'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_det_onnx_infer.tar',
    'en_PP-OCRv5_mobile_rec.tar':
      'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/en_PP-OCRv5_mobile_rec_onnx_infer.tar',
    'latin_PP-OCRv5_mobile_rec.tar':
      'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/latin_PP-OCRv5_mobile_rec_onnx_infer.tar'
  };
  await page.route(/\/api\/ocr-models\/([^/]+)$/, async (route) => {
    const name = route.request().url().split('/').pop() as keyof typeof upstream;
    const response = await page.request.get(upstream[name]);
    await route.fulfill({ response });
  });

  await page.goto('/health');
  const results = await page.evaluate(async (modulePath) => {
    const module = (await import(modulePath)) as {
      createLocalOcrRunner(profileId?: 'english' | 'latin'): Promise<{
        predict(input: Blob): Promise<Array<{ items: Array<{ text: string }> }>>;
        dispose(): Promise<void>;
      }>;
    };
    const canvas = document.createElement('canvas');
    canvas.width = 1_000;
    canvas.height = 300;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111111';
    context.font = '72px cursive';
    context.fillText('StudySky handwritten notes', 55, 175);
    const input = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not create OCR test image.'))),
        'image/png'
      )
    );
    const output: Record<string, string[]> = {};
    for (const profileId of ['english', 'latin'] as const) {
      const runner = await module.createLocalOcrRunner(profileId);
      try {
        const result = await runner.predict(input);
        output[profileId] = result.flatMap((pageResult) =>
          pageResult.items.map((item) => item.text)
        );
      } finally {
        await runner.dispose();
      }
    }
    return output;
  }, runnerPath);

  expect(results.english.join(' ').trim().length).toBeGreaterThan(3);
  expect(results.latin.join(' ').trim().length).toBeGreaterThan(3);
});

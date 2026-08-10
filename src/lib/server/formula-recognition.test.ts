import { describe, expect, it, vi } from 'vitest';
import {
  FormulaRecognitionError,
  formulaRecognitionStatus,
  getFormulaRecognitionConfig,
  recogniseFormulaImage
} from './formula-recognition';

const enabledEnvironment = {
  FORMULA_OCR_ENABLED: 'true',
  FORMULA_OCR_URL: 'http://formula-ocr:8080',
  FORMULA_OCR_TOKEN: 'a'.repeat(32),
  FORMULA_OCR_TIMEOUT_MS: '10000'
};

describe('formula recognition boundary', () => {
  it('stays disabled in the lightweight base installation', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(formulaRecognitionStatus({ env: {}, fetchImpl })).resolves.toEqual({
      enabled: false,
      ready: false,
      model: null,
      layoutModel: null
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('accepts only http services without embedded credentials', () => {
    expect(getFormulaRecognitionConfig(enabledEnvironment).endpoint.href).toBe(
      'http://formula-ocr:8080/'
    );
    expect(() =>
      getFormulaRecognitionConfig({
        ...enabledEnvironment,
        FORMULA_OCR_URL: 'file:///private/model'
      })
    ).toThrow(FormulaRecognitionError);
  });

  it('forwards only a bounded image and validates the formula response', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'PP-FormulaNet-S',
          layoutModel: 'PP-DocLayout-M',
          engine: 'PaddleOCR PP-FormulaNet-S + PP-DocLayout-M',
          formulas: [{ latex: 'x^{2}+y^{2}=z^{2}', box: [1, 2, 3, 4] }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    await expect(
      recogniseFormulaImage(Buffer.from('image'), 'formula', {
        env: enabledEnvironment,
        fetchImpl
      })
    ).resolves.toMatchObject({
      model: 'PP-FormulaNet-S',
      formulas: [{ latex: 'x^{2}+y^{2}=z^{2}', box: [1, 2, 3, 4] }]
    });
    const [, request] = fetchImpl.mock.calls[0];
    expect(request?.headers).toMatchObject({ authorization: `Bearer ${'a'.repeat(32)}` });
    expect(JSON.parse(String(request?.body))).toEqual({
      image: Buffer.from('image').toString('base64'),
      mode: 'formula'
    });
  });

  it('does not accept an enabled service without a shared secret', async () => {
    await expect(
      recogniseFormulaImage(Buffer.from('image'), 'page', {
        env: { ...enabledEnvironment, FORMULA_OCR_TOKEN: '' },
        fetchImpl: vi.fn<typeof fetch>()
      })
    ).rejects.toMatchObject({ status: 503 });
  });

  it('bounds the internal service response even without a content-length header', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('x'.repeat(1_000_001), { status: 200 }));
    await expect(
      recogniseFormulaImage(Buffer.from('image'), 'formula', {
        env: enabledEnvironment,
        fetchImpl
      })
    ).rejects.toMatchObject({ status: 502 });
  });
});

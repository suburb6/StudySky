import { describe, expect, it, vi } from 'vitest';
import {
  normaliseOcrProviderUrl,
  parseOcrCapabilities,
  recogniseWithCustomOcrProvider,
  testCustomOcrProvider
} from './custom-ocr-provider';

const settings = {
  id: '7bad470a-c0db-4e31-9bff-37394db109d7',
  name: 'Campus OCR',
  baseUrl: 'http://campus-ocr:8080/',
  token: 'secret-token',
  capabilities: ['text', 'formula_latex'] as const,
  languages: ['English'],
  timeoutMs: 5_000,
  maxImageBytes: 1024,
  maxPixels: 1_000_000
};

describe('custom OCR provider contract', () => {
  it('normalises safe HTTP endpoints and rejects embedded credentials', () => {
    expect(normaliseOcrProviderUrl('http://ocr:8080/api/')).toBe('http://ocr:8080/api');
    expect(() => normaliseOcrProviderUrl('file:///models/ocr')).toThrow(/HTTP or HTTPS/);
    expect(() => normaliseOcrProviderUrl('https://user:pass@example.com')).toThrow(/credentials/);
  });

  it('filters stored capabilities to the supported contract', () => {
    expect(parseOcrCapabilities(['text', 'unknown', 'text', 'formula_latex'])).toEqual([
      'text',
      'formula_latex'
    ]);
  });

  it('tests health and requires every administrator-approved capability', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        status: 'ready',
        model: 'student-notes-v1',
        capabilities: ['text']
      })
    );
    const result = await testCustomOcrProvider(
      { ...settings, capabilities: [...settings.capabilities] },
      fetchImpl
    );
    expect(result).toEqual({
      ok: false,
      message: 'Provider does not advertise: formula_latex.'
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('http://campus-ocr:8080/health'),
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer secret-token' })
      })
    );
  });

  it('normalises a text recognition response', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        model: 'student-notes-v1',
        engine: 'Campus OCR 1.2',
        text: 'Integral from zero to one',
        confidence: 0.91
      })
    );
    const result = await recogniseWithCustomOcrProvider(
      { ...settings, capabilities: [...settings.capabilities] },
      Buffer.from('image'),
      'text',
      { language: 'English', fetchImpl }
    );
    expect(result).toMatchObject({
      outputKind: 'text',
      text: 'Integral from zero to one',
      confidence: 0.91,
      engine: 'Campus OCR 1.2'
    });
    const request = fetchImpl.mock.calls[0][1]!;
    expect(JSON.parse(String(request.body))).toMatchObject({
      capability: 'text',
      language: 'English'
    });
  });

  it('rejects oversized images before contacting a provider', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      recogniseWithCustomOcrProvider(
        { ...settings, capabilities: [...settings.capabilities], maxImageBytes: 2 },
        Buffer.from('image'),
        'text',
        { fetchImpl }
      )
    ).rejects.toMatchObject({ status: 413 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects unbounded or malformed provider output', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"model":"x"}', { status: 200 }));
    await expect(
      recogniseWithCustomOcrProvider(
        { ...settings, capabilities: [...settings.capabilities] },
        Buffer.from('image'),
        'formula_latex',
        { fetchImpl }
      )
    ).rejects.toMatchObject({ status: 502 });
  });
});

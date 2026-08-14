import { z } from 'zod';
import { isOcrCapability, type OcrCapability } from '$lib/domain/ocr-providers';

export const DEFAULT_OCR_PROVIDER_IMAGE_BYTES = 6 * 1024 * 1024;
export const DEFAULT_OCR_PROVIDER_IMAGE_PIXELS = 16_000_000;

export type CustomOcrProviderSettings = {
  id: string;
  name: string;
  baseUrl: string;
  token: string | null;
  capabilities: OcrCapability[];
  languages: string[];
  timeoutMs: number;
  maxImageBytes: number;
  maxPixels: number;
};

export type CustomOcrResult = {
  model: string;
  engine: string;
  outputKind: OcrCapability;
  text: string;
  confidence: number | null;
  formulas: Array<{ latex: string; box: [number, number, number, number] | null }>;
};

const healthSchema = z.object({
  status: z.literal('ready'),
  model: z.string().min(1).max(120),
  engine: z.string().min(1).max(160).optional(),
  capabilities: z
    .array(z.enum(['text', 'formula_latex']))
    .min(1)
    .max(2)
});

const formulaSchema = z.object({
  latex: z.string().min(1).max(20_000),
  box: z
    .tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
    .nullable()
    .optional()
});

const recognitionSchema = z
  .object({
    model: z.string().min(1).max(120),
    engine: z.string().min(1).max(160).optional(),
    text: z.string().max(200_000).optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    formulas: z.array(formulaSchema).max(100).optional()
  })
  .superRefine((value, context) => {
    if (!value.text?.trim() && !value.formulas?.length) {
      context.addIssue({ code: 'custom', message: 'The provider returned no text.' });
    }
  });

export class CustomOcrProviderError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'CustomOcrProviderError';
  }
}

export function normaliseOcrProviderUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Provider URL must use HTTP or HTTPS.');
  }
  if (url.username || url.password) {
    throw new Error('Do not place credentials in the provider URL.');
  }
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

export function parseOcrCapabilities(value: unknown): OcrCapability[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isOcrCapability))];
}

export function parseOcrLanguages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string'))]
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function providerUrl(settings: CustomOcrProviderSettings, path: string) {
  return new URL(`${normaliseOcrProviderUrl(settings.baseUrl)}${path}`);
}

function headers(settings: CustomOcrProviderSettings) {
  return {
    accept: 'application/json',
    ...(settings.token ? { authorization: `Bearer ${settings.token}` } : {})
  };
}

function timeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function boundedJson(response: Response): Promise<unknown> {
  const maximum = 1_000_000;
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maximum) throw new CustomOcrProviderError('Provider response is too large.', 502);
  const reader = response.body?.getReader();
  if (!reader) return {};
  const decoder = new TextDecoder();
  let body = '';
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) {
        await reader.cancel();
        throw new CustomOcrProviderError('Provider response is too large.', 502);
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body);
  } catch (error) {
    if (error instanceof CustomOcrProviderError) throw error;
    throw new CustomOcrProviderError('Provider returned an invalid response.', 502);
  } finally {
    reader.releaseLock();
  }
}

export async function testCustomOcrProvider(
  settings: CustomOcrProviderSettings,
  fetchImpl: typeof fetch = fetch
) {
  const timeout = timeoutSignal(Math.min(settings.timeoutMs, 10_000));
  try {
    const response = await fetchImpl(providerUrl(settings, '/health'), {
      headers: headers(settings),
      signal: timeout.signal
    });
    if (!response.ok) {
      return { ok: false, message: `Provider returned HTTP ${response.status}.` };
    }
    const parsed = healthSchema.safeParse(await boundedJson(response));
    if (!parsed.success) return { ok: false, message: 'Provider health response is invalid.' };
    const missing = settings.capabilities.filter(
      (capability) => !parsed.data.capabilities.includes(capability)
    );
    if (missing.length) {
      return { ok: false, message: `Provider does not advertise: ${missing.join(', ')}.` };
    }
    return {
      ok: true,
      message: `${parsed.data.model} is ready for ${parsed.data.capabilities.join(' and ')}.`,
      model: parsed.data.model
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error && error.name === 'AbortError'
          ? 'Provider connection timed out.'
          : 'Provider connection failed.'
    };
  } finally {
    timeout.clear();
  }
}

export async function recogniseWithCustomOcrProvider(
  settings: CustomOcrProviderSettings,
  image: Buffer,
  capability: OcrCapability,
  options: { mode?: 'page' | 'formula'; language?: string; fetchImpl?: typeof fetch } = {}
): Promise<CustomOcrResult> {
  if (!settings.capabilities.includes(capability)) {
    throw new CustomOcrProviderError('This model is not enabled for that task.', 400);
  }
  if (!image.length) throw new CustomOcrProviderError('The image is empty.', 400);
  if (image.length > settings.maxImageBytes) {
    throw new CustomOcrProviderError('The image is too large for this model.', 413);
  }
  const timeout = timeoutSignal(settings.timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(providerUrl(settings, '/v1/recognise'), {
      method: 'POST',
      headers: { ...headers(settings), 'content-type': 'application/json' },
      body: JSON.stringify({
        image: image.toString('base64'),
        capability,
        mode: options.mode ?? 'page',
        ...(options.language ? { language: options.language } : {})
      }),
      signal: timeout.signal
    });
    const decoded = await boundedJson(response);
    if (!response.ok) {
      const error = z.object({ error: z.string().min(1).max(240) }).safeParse(decoded);
      throw new CustomOcrProviderError(
        error.success ? error.data.error : 'OCR recognition could not finish.',
        [400, 413, 415, 429].includes(response.status) ? response.status : 502
      );
    }
    const parsed = recognitionSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new CustomOcrProviderError('Provider returned an invalid recognition result.', 502);
    }
    const formulas = (parsed.data.formulas ?? []).map((formula) => ({
      latex: formula.latex,
      box: formula.box ?? null
    }));
    const text =
      parsed.data.text?.trim() || formulas.map((formula) => formula.latex.trim()).join('\n\n');
    return {
      model: parsed.data.model,
      engine: parsed.data.engine ?? `${settings.name} · ${parsed.data.model}`,
      outputKind: capability,
      text,
      confidence: parsed.data.confidence ?? null,
      formulas
    };
  } catch (error) {
    if (error instanceof CustomOcrProviderError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new CustomOcrProviderError('OCR recognition timed out. Try a smaller page.', 504);
    }
    throw new CustomOcrProviderError('The selected OCR model is unavailable.', 503);
  } finally {
    timeout.clear();
  }
}

import { z } from 'zod';

export const DEFAULT_FORMULA_IMAGE_BYTES = 6 * 1024 * 1024;
export const DEFAULT_FORMULA_IMAGE_PIXELS = 16_000_000;

export type FormulaRecognitionMode = 'page' | 'formula';

export type FormulaRecognitionResult = {
  model: string;
  layoutModel: string;
  engine: string;
  formulas: Array<{
    latex: string;
    box: [number, number, number, number] | null;
  }>;
};

type FormulaRecognitionConfig = {
  enabled: boolean;
  endpoint: URL;
  token: string;
  timeoutMs: number;
  maxImageBytes: number;
  maxPixels: number;
};

type FormulaRecognitionOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
};

const formulaResponseSchema = z.object({
  model: z.string().min(1).max(80),
  layoutModel: z.string().min(1).max(80),
  engine: z.string().min(1).max(160),
  formulas: z
    .array(
      z.object({
        latex: z.string().min(1).max(20_000),
        box: z
          .tuple([
            z.number().finite(),
            z.number().finite(),
            z.number().finite(),
            z.number().finite()
          ])
          .nullable()
      })
    )
    .max(100)
});

const healthResponseSchema = z.object({
  status: z.literal('ready'),
  model: z.string().min(1).max(80),
  layoutModel: z.string().min(1).max(80)
});

export class FormulaRecognitionError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'FormulaRecognitionError';
  }
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

export function getFormulaRecognitionConfig(
  env: NodeJS.ProcessEnv = process.env
): FormulaRecognitionConfig {
  const rawEndpoint = env.FORMULA_OCR_URL?.trim() || 'http://formula-ocr:8080';
  let endpoint: URL;
  try {
    endpoint = new URL(rawEndpoint);
  } catch {
    throw new FormulaRecognitionError('The formula recognizer is not configured correctly.', 503);
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new FormulaRecognitionError('The formula recognizer is not configured correctly.', 503);
  }
  endpoint.search = '';
  endpoint.hash = '';
  endpoint.pathname = endpoint.pathname.replace(/\/$/, '');

  return {
    enabled: env.FORMULA_OCR_ENABLED === 'true',
    endpoint,
    token: env.FORMULA_OCR_TOKEN?.trim() || '',
    timeoutMs: boundedInteger(env.FORMULA_OCR_TIMEOUT_MS, 90_000, 5_000, 180_000),
    maxImageBytes: boundedInteger(
      env.FORMULA_OCR_MAX_IMAGE_BYTES,
      DEFAULT_FORMULA_IMAGE_BYTES,
      256 * 1024,
      12 * 1024 * 1024
    ),
    maxPixels: boundedInteger(
      env.FORMULA_OCR_MAX_PIXELS,
      DEFAULT_FORMULA_IMAGE_PIXELS,
      1_000_000,
      40_000_000
    )
  };
}

function requireEnabled(config: FormulaRecognitionConfig) {
  if (!config.enabled) {
    throw new FormulaRecognitionError(
      'Formula to LaTeX is not enabled on this StudySky installation.',
      503
    );
  }
  if (config.token.length < 32) {
    throw new FormulaRecognitionError('The formula recognizer is not configured correctly.', 503);
  }
}

function serviceUrl(config: FormulaRecognitionConfig, path: string) {
  const endpoint = new URL(config.endpoint);
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, '')}${path}`;
  return endpoint;
}

async function responseText(response: Response) {
  const limit = 1_000_000;
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > limit) {
    throw new FormulaRecognitionError('The formula recognizer returned an invalid response.', 502);
  }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new FormulaRecognitionError(
          'The formula recognizer returned an invalid response.',
          502
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return text;
}

function withTimeout(timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  return { controller, clear: () => clearTimeout(timer) };
}

export async function formulaRecognitionStatus(options: FormulaRecognitionOptions = {}) {
  const config = getFormulaRecognitionConfig(options.env);
  if (!config.enabled) return { enabled: false, ready: false, model: null, layoutModel: null };
  if (config.token.length < 32) {
    return { enabled: true, ready: false, model: null, layoutModel: null };
  }

  const timeout = withTimeout(Math.min(config.timeoutMs, 5_000));
  try {
    const response = await (options.fetchImpl ?? fetch)(serviceUrl(config, '/health'), {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: timeout.controller.signal
    });
    if (!response.ok) return { enabled: true, ready: false, model: null, layoutModel: null };
    const parsed = healthResponseSchema.safeParse(JSON.parse(await responseText(response)));
    if (!parsed.success) return { enabled: true, ready: false, model: null, layoutModel: null };
    return {
      enabled: true,
      ready: true,
      model: parsed.data.model,
      layoutModel: parsed.data.layoutModel
    };
  } catch {
    return { enabled: true, ready: false, model: null, layoutModel: null };
  } finally {
    timeout.clear();
  }
}

export async function recogniseFormulaImage(
  image: Buffer,
  mode: FormulaRecognitionMode,
  options: FormulaRecognitionOptions = {}
): Promise<FormulaRecognitionResult> {
  const config = getFormulaRecognitionConfig(options.env);
  requireEnabled(config);
  if (!image.length) throw new FormulaRecognitionError('The formula image is empty.', 400);
  if (image.length > config.maxImageBytes) {
    throw new FormulaRecognitionError('The formula image is too large.', 413);
  }

  const timeout = withTimeout(config.timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(serviceUrl(config, '/v1/formula'), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${config.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ image: image.toString('base64'), mode }),
      signal: timeout.controller.signal
    });
    const body = await responseText(response);
    if (!response.ok) {
      let message = 'Formula recognition could not finish.';
      try {
        const parsed = z.object({ error: z.string().min(1).max(240) }).safeParse(JSON.parse(body));
        if (parsed.success) message = parsed.data.error;
      } catch {
        // Keep the stable user-facing message when the internal service did not return JSON.
      }
      const status = [400, 413, 415, 429].includes(response.status) ? response.status : 502;
      throw new FormulaRecognitionError(message, status);
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(body);
    } catch {
      throw new FormulaRecognitionError(
        'The formula recognizer returned an invalid response.',
        502
      );
    }
    const parsed = formulaResponseSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new FormulaRecognitionError(
        'The formula recognizer returned an invalid response.',
        502
      );
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof FormulaRecognitionError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new FormulaRecognitionError('Formula recognition timed out. Try a smaller page.', 504);
    }
    throw new FormulaRecognitionError('The self-hosted formula recognizer is unavailable.', 503);
  } finally {
    timeout.clear();
  }
}

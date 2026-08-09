import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface AIProviderSettings {
  provider: string;
  baseUrl: string | null;
  model: string | null;
  apiKey: string | null;
  timeoutMs: number;
}

export interface AIConnectionResult {
  ok: boolean;
  message: string;
  models?: string[];
}

export interface AIProvider {
  testConnection(): Promise<AIConnectionResult>;
}

class NoAIProvider implements AIProvider {
  async testConnection(): Promise<AIConnectionResult> {
    return {
      ok: true,
      message: 'No AI is configured. StudySky’s core features remain fully available.'
    };
  }
}

class OpenAICompatibleProvider implements AIProvider {
  constructor(private readonly settings: AIProviderSettings) {}

  async testConnection(): Promise<AIConnectionResult> {
    if (!this.settings.baseUrl) {
      return { ok: false, message: 'Enter an OpenAI-compatible endpoint URL.' };
    }
    const base = validateProviderUrl(this.settings.baseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.settings.timeoutMs);
    try {
      const response = await fetch(new URL('v1/models', ensureTrailingSlash(base)), {
        headers: this.settings.apiKey
          ? { authorization: `Bearer ${this.settings.apiKey}` }
          : undefined,
        signal: controller.signal
      });
      if (!response.ok) {
        return {
          ok: false,
          message: `Provider returned HTTP ${response.status}. Check the URL and credentials.`
        };
      }
      const value = (await response.json()) as {
        data?: Array<{ id?: unknown }>;
      };
      const models = (value.data ?? [])
        .map((item) => (typeof item.id === 'string' ? item.id : null))
        .filter((item): item is string => Boolean(item))
        .slice(0, 10);
      return {
        ok: true,
        message: models.length
          ? `Connection succeeded. ${models.length} model${models.length === 1 ? '' : 's'} visible.`
          : 'Connection succeeded.',
        models
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error && error.name === 'AbortError'
            ? 'Provider connection timed out.'
            : `Provider connection failed: ${error instanceof Error ? error.message : 'unknown error'}`
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createAIProvider(settings: AIProviderSettings): AIProvider {
  if (settings.provider === 'none') return new NoAIProvider();
  if (settings.provider === 'openai_compatible') {
    return new OpenAICompatibleProvider(settings);
  }
  throw new Error(`Unsupported AI provider: ${settings.provider}`);
}

export function encryptCredential(value: string): string {
  const key = settingsEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url')
  ].join('.');
}

export function decryptCredential(value: string | null): string | null {
  if (!value) return null;
  const [version, ivValue, tagValue, encryptedValue] = value.split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) {
    throw new Error('Saved credential has an unsupported format.');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    settingsEncryptionKey(),
    Buffer.from(ivValue, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

export function encryptionConfigured(): boolean {
  try {
    settingsEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

function settingsEncryptionKey(): Buffer {
  const configured = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!configured) {
    throw new Error('SETTINGS_ENCRYPTION_KEY is required before saving an API key.');
  }
  const key = Buffer.from(configured, 'base64');
  if (key.byteLength !== 32) {
    throw new Error('SETTINGS_ENCRYPTION_KEY must be exactly 32 bytes encoded as base64.');
  }
  return key;
}

function validateProviderUrl(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Provider URL must use HTTP or HTTPS.');
  }
  if (url.username || url.password) {
    throw new Error('Do not place credentials in the provider URL.');
  }
  return url;
}

function ensureTrailingSlash(url: URL): URL {
  const copy = new URL(url);
  if (!copy.pathname.endsWith('/')) copy.pathname += '/';
  return copy;
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertPdfPageCountWithinLimit, maximumPdfProcessingPages } from './document-processing';

describe('document processing limits', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts the configured PDF page boundary and rejects larger documents', () => {
    expect(() => assertPdfPageCountWithinLimit(500, 500)).not.toThrow();
    expect(() => assertPdfPageCountWithinLimit(501, 500)).toThrow(
      'the server processing limit is 500'
    );
  });

  it('uses a safe default and caps excessive configuration', () => {
    vi.stubEnv('MAX_PDF_PROCESSING_PAGES', 'not-a-number');
    expect(maximumPdfProcessingPages()).toBe(500);
    vi.stubEnv('MAX_PDF_PROCESSING_PAGES', '50000');
    expect(maximumPdfProcessingPages()).toBe(10_000);
  });
});

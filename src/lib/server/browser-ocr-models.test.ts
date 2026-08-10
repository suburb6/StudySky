import { describe, expect, it } from 'vitest';
import { browserOcrDetectionModel, browserOcrProfiles } from '$lib/domain/browser-ocr-profiles';
import { isBrowserOcrModelName } from './browser-ocr-models';

describe('browser OCR model manifest', () => {
  it('serves every asset referenced by a curated profile', () => {
    expect(isBrowserOcrModelName(browserOcrDetectionModel.assetName)).toBe(true);
    for (const profile of browserOcrProfiles) {
      expect(isBrowserOcrModelName(profile.recognitionAssetName)).toBe(true);
    }
  });

  it('does not accept arbitrary model names', () => {
    expect(isBrowserOcrModelName('../model.tar')).toBe(false);
    expect(isBrowserOcrModelName('https://example.com/model.tar')).toBe(false);
  });
});

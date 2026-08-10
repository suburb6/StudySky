import { describe, expect, it } from 'vitest';
import {
  browserOcrProfiles,
  defaultBrowserOcrProfileId,
  getBrowserOcrProfile,
  isBrowserOcrProfileId
} from './browser-ocr-profiles';

describe('browser OCR profiles', () => {
  it('keeps a valid lightweight default', () => {
    const profile = getBrowserOcrProfile();

    expect(profile.id).toBe(defaultBrowserOcrProfileId);
    expect(profile.recommended).toBe(true);
  });

  it('accepts only curated profile identifiers', () => {
    expect(isBrowserOcrProfileId('latin')).toBe(true);
    expect(isBrowserOcrProfileId('https://example.com/model.tar')).toBe(false);
    expect(getBrowserOcrProfile('untrusted')).toEqual(getBrowserOcrProfile());
  });

  it('uses unique, auditable model assets and saveable engine labels', () => {
    const assetNames = browserOcrProfiles.map((profile) => profile.recognitionAssetName);

    expect(new Set(assetNames).size).toBe(assetNames.length);
    expect(assetNames.every((name) => name.endsWith('.tar'))).toBe(true);
    expect(browserOcrProfiles.every((profile) => profile.engine.length <= 120)).toBe(true);
  });
});

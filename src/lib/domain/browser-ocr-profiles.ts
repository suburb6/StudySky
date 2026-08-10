export const browserOcrDetectionModel = {
  name: 'PP-OCRv5_mobile_det',
  assetName: 'PP-OCRv5_mobile_det.tar'
} as const;

export const browserOcrProfiles = [
  {
    id: 'english',
    label: 'English handwriting',
    description: 'Best default for handwritten and printed English notes.',
    recognitionModelName: 'en_PP-OCRv5_mobile_rec',
    recognitionAssetName: 'en_PP-OCRv5_mobile_rec.tar',
    engine: 'PaddleOCR.js PP-OCRv5 mobile English',
    recommended: true
  },
  {
    id: 'latin',
    label: 'English, French & symbols',
    description:
      'Reads accented Latin text and common maths symbols. Complex formula layout still needs review.',
    recognitionModelName: 'latin_PP-OCRv5_mobile_rec',
    recognitionAssetName: 'latin_PP-OCRv5_mobile_rec.tar',
    engine: 'PaddleOCR.js PP-OCRv5 mobile Latin',
    recommended: false
  }
] as const;

export type BrowserOcrProfile = (typeof browserOcrProfiles)[number];
export type BrowserOcrProfileId = BrowserOcrProfile['id'];

export const defaultBrowserOcrProfileId: BrowserOcrProfileId = 'english';

export function isBrowserOcrProfileId(value: string | null): value is BrowserOcrProfileId {
  return browserOcrProfiles.some((profile) => profile.id === value);
}

export function getBrowserOcrProfile(value?: string | null): BrowserOcrProfile {
  return (
    browserOcrProfiles.find((profile) => profile.id === value) ??
    browserOcrProfiles.find((profile) => profile.id === defaultBrowserOcrProfileId)!
  );
}

export const ocrCapabilityValues = ['text', 'formula_latex'] as const;

export type OcrCapability = (typeof ocrCapabilityValues)[number];

export type AvailableOcrProvider = {
  id: string;
  name: string;
  description: string;
  capabilities: OcrCapability[];
  languages: string[];
  location: 'browser' | 'server';
  model: string | null;
};

export function isOcrCapability(value: unknown): value is OcrCapability {
  return typeof value === 'string' && ocrCapabilityValues.includes(value as OcrCapability);
}

export const gradingPresetValues = ['uom_2026_27', 'custom_weighted_percentage'] as const;

export type GradingPreset = (typeof gradingPresetValues)[number];

export interface GradingPreferences {
  enabled: boolean;
  preset: GradingPreset;
  passMark: 40 | 50;
  formulaNotes: string;
}

export interface AssessmentForGrade {
  achievedMark: number | string | null;
  maximumMark: number | string;
  weight: number | string | null;
}

export interface ModuleForCpa {
  id: string;
  code: string;
  markPercent: number | null;
  creditUnits: number | string | null;
  gradeWeight: number | string | null;
}

export interface CpaSummary {
  value: number | null;
  classification: string | null;
  borderlineFor: string | null;
  includedModules: number;
  missingResults: number;
  missingCredits: number;
}

export function normalizeGradingPreferences(value: unknown): GradingPreferences {
  const source = isRecord(value) ? value : {};
  const preset = gradingPresetValues.includes(source.preset as GradingPreset)
    ? (source.preset as GradingPreset)
    : 'custom_weighted_percentage';
  return {
    enabled: source.enabled === true,
    preset,
    passMark: Number(source.passMark) === 50 ? 50 : 40,
    formulaNotes: typeof source.formulaNotes === 'string' ? source.formulaNotes.slice(0, 5_000) : ''
  };
}

export function calculateModuleMark(assessments: AssessmentForGrade[]): number | null {
  let weightedMarks = 0;
  let totalWeight = 0;
  for (const assessment of assessments) {
    if (assessment.achievedMark === null) continue;
    const achieved = finiteNumber(assessment.achievedMark);
    const maximum = finiteNumber(assessment.maximumMark);
    const weight = assessment.weight === null ? 1 : finiteNumber(assessment.weight);
    if (achieved === null || maximum === null || maximum <= 0 || weight === null || weight < 0) {
      continue;
    }
    weightedMarks += (achieved / maximum) * 100 * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? weightedMarks / totalWeight : null;
}

export function calculateCpa(modules: ModuleForCpa[], preferences: GradingPreferences): CpaSummary {
  let weightedMarks = 0;
  let totalWeight = 0;
  let includedModules = 0;
  let missingResults = 0;
  let missingCredits = 0;

  for (const module of modules) {
    if (module.markPercent === null || !Number.isFinite(module.markPercent)) {
      missingResults += 1;
      continue;
    }
    const credits = finiteNumber(module.creditUnits);
    const gradeWeight = module.gradeWeight === null ? 1 : finiteNumber(module.gradeWeight);
    if (credits === null || credits <= 0 || gradeWeight === null || gradeWeight <= 0) {
      missingCredits += 1;
      continue;
    }
    const moduleWeight = credits * gradeWeight;
    weightedMarks += module.markPercent * moduleWeight;
    totalWeight += moduleWeight;
    includedModules += 1;
  }

  const value = totalWeight > 0 ? weightedMarks / totalWeight : null;
  const classification =
    value !== null && preferences.preset === 'uom_2026_27'
      ? uomClassification(value, preferences.passMark)
      : null;
  const borderlineFor =
    value !== null && preferences.preset === 'uom_2026_27'
      ? uomBorderline(value, preferences.passMark)
      : null;

  return {
    value,
    classification,
    borderlineFor,
    includedModules,
    missingResults,
    missingCredits
  };
}

export function uomClassification(value: number, passMark: 40 | 50): string {
  if (value >= 70) return 'First Class';
  if (value >= 60) return 'Upper Second Class';
  if (value >= 50) return 'Lower Second Class';
  if (passMark === 40 && value >= 45) return 'Third Class';
  if (passMark === 40 && value >= 40) return 'Pass';
  return 'Below pass mark';
}

function uomBorderline(value: number, passMark: 40 | 50): string | null {
  const thresholds: Array<readonly [number, string]> =
    passMark === 40
      ? [
          [70, 'First Class'],
          [60, 'Upper Second Class'],
          [50, 'Lower Second Class'],
          [45, 'Third Class'],
          [40, 'Pass']
        ]
      : [
          [70, 'First Class'],
          [60, 'Upper Second Class'],
          [50, 'Lower Second Class']
        ];
  const next = thresholds.find(([threshold]) => value < threshold && threshold - value <= 0.5);
  return next?.[1] ?? null;
}

function finiteNumber(value: number | string | null): number | null {
  if (value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

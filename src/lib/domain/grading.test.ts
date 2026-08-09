import { describe, expect, it } from 'vitest';
import {
  calculateCpa,
  calculateModuleMark,
  normalizeGradingPreferences,
  uomClassification
} from './grading';

describe('grading calculations', () => {
  it('uses generic weighted grading by default', () => {
    expect(normalizeGradingPreferences({}).preset).toBe('custom_weighted_percentage');
  });

  it('calculates a module percentage using assessment weights', () => {
    expect(
      calculateModuleMark([
        { achievedMark: '16', maximumMark: '20', weight: '25' },
        { achievedMark: '60', maximumMark: '100', weight: '75' }
      ])
    ).toBe(65);
  });

  it('calculates UoM CPA from credit units and academic weighting', () => {
    const summary = calculateCpa(
      [
        { id: 'a', code: 'A', markPercent: 80, creditUnits: 3, gradeWeight: 1 },
        { id: 'b', code: 'B', markPercent: 50, creditUnits: 6, gradeWeight: 1.5 }
      ],
      normalizeGradingPreferences({ enabled: true, preset: 'uom_2026_27', passMark: 40 })
    );
    expect(summary.value).toBeCloseTo(57.5);
    expect(summary.classification).toBe('Lower Second Class');
    expect(summary.includedModules).toBe(2);
  });

  it('reports incomplete modules instead of inventing inputs', () => {
    const summary = calculateCpa(
      [
        { id: 'a', code: 'A', markPercent: null, creditUnits: 3, gradeWeight: 1 },
        { id: 'b', code: 'B', markPercent: 65, creditUnits: null, gradeWeight: 1 }
      ],
      normalizeGradingPreferences({ enabled: true })
    );
    expect(summary.value).toBeNull();
    expect(summary.missingResults).toBe(1);
    expect(summary.missingCredits).toBe(1);
  });

  it('does not automatically promote a borderline result', () => {
    const summary = calculateCpa(
      [{ id: 'a', code: 'A', markPercent: 69.7, creditUnits: 3, gradeWeight: 1 }],
      normalizeGradingPreferences({ enabled: true, preset: 'uom_2026_27' })
    );
    expect(uomClassification(69.7, 40)).toBe('Upper Second Class');
    expect(summary.borderlineFor).toBe('First Class');
  });
});

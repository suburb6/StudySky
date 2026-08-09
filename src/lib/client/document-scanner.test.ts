import { describe, expect, it } from 'vitest';
import { orderCorners } from './document-scanner';

describe('document corner ordering', () => {
  it('orders an arbitrary rectangle as top-left, top-right, bottom-right, bottom-left', () => {
    expect(
      orderCorners([
        { x: 900, y: 700 },
        { x: 100, y: 100 },
        { x: 120, y: 720 },
        { x: 920, y: 80 }
      ])
    ).toEqual([
      { x: 100, y: 100 },
      { x: 920, y: 80 },
      { x: 900, y: 700 },
      { x: 120, y: 720 }
    ]);
  });

  it('orders a skewed page without depending on the input order', () => {
    expect(
      orderCorners([
        { x: 80, y: 520 },
        { x: 440, y: 610 },
        { x: 500, y: 90 },
        { x: 130, y: 40 }
      ])
    ).toEqual([
      { x: 130, y: 40 },
      { x: 500, y: 90 },
      { x: 440, y: 610 },
      { x: 80, y: 520 }
    ]);
  });
});

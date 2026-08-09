export interface ScanCorner {
  x: number;
  y: number;
}

export function orderCorners(
  points: ScanCorner[]
): [ScanCorner, ScanCorner, ScanCorner, ScanCorner] {
  if (points.length !== 4) throw new Error('A document boundary must contain four corners.');
  const bySum = [...points].sort((first, second) => first.x + first.y - (second.x + second.y));
  const byDifference = [...points].sort(
    (first, second) => first.y - first.x - (second.y - second.x)
  );
  const result = [bySum[0], byDifference[0], bySum[3], byDifference[3]] as const;
  if (new Set(result).size === 4) {
    return [result[0], result[1], result[2], result[3]];
  }

  const centre = points.reduce(
    (value, point) => ({ x: value.x + point.x / 4, y: value.y + point.y / 4 }),
    { x: 0, y: 0 }
  );
  const clockwise = [...points].sort(
    (first, second) =>
      Math.atan2(first.y - centre.y, first.x - centre.x) -
      Math.atan2(second.y - centre.y, second.x - centre.x)
  );
  const topLeftIndex = clockwise.reduce(
    (best, point, index) =>
      point.x + point.y < clockwise[best].x + clockwise[best].y ? index : best,
    0
  );
  const rotated = [
    ...clockwise.slice(topLeftIndex),
    ...clockwise.slice(0, topLeftIndex)
  ] as ScanCorner[];
  if (rotated[1].x < rotated[3].x) {
    return [rotated[0], rotated[3], rotated[2], rotated[1]];
  }
  return rotated as [ScanCorner, ScanCorner, ScanCorner, ScanCorner];
}

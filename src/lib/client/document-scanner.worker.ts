/// <reference lib="webworker" />

import { orderCorners, type ScanCorner } from './document-geometry';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<{ file: File }>) => {
  void correctInWorker(event.data.file)
    .then(({ blob, name }) => self.postMessage({ ok: true, blob, name }))
    .catch((error) =>
      self.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : 'Page correction failed.'
      })
    );
};

async function correctInWorker(file: File) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const detectionCanvas = drawScaledBitmap(bitmap, 700);
    const corners = detectPageCorners(detectionCanvas);
    const sourceCanvas = drawScaledBitmap(bitmap, 2_400);
    const scaledCorners = orderCorners(
      corners.map((corner) => ({
        x: corner.x * (sourceCanvas.width / detectionCanvas.width),
        y: corner.y * (sourceCanvas.height / detectionCanvas.height)
      }))
    );
    return {
      blob: await warpPage(sourceCanvas, scaledCorners),
      name: `${safeStem(file.name)}-corrected.jpg`
    };
  } finally {
    bitmap.close();
  }
}

function detectPageCorners(canvas: OffscreenCanvas): ScanCorner[] {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas processing is unavailable in this browser.');
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const background = cornerBackground(image);
  const distance = colourDistanceMap(image, background);
  const threshold = Math.max(18, otsuThreshold(distance));
  let mask = new Uint8Array(distance.length);
  for (let index = 0; index < distance.length; index += 1) {
    mask[index] = distance[index] >= threshold ? 1 : 0;
  }
  mask = erode(dilate(mask, canvas.width, canvas.height), canvas.width, canvas.height);
  const component = largestComponent(mask, canvas.width, canvas.height);
  if (component.length < canvas.width * canvas.height * 0.1) {
    throw new Error(
      'StudySky could not separate the page from its background. Use the manual crop controls instead.'
    );
  }
  const corners = componentCorners(component, canvas.width, canvas.height);
  if (polygonArea(corners) < canvas.width * canvas.height * 0.1) {
    throw new Error(
      'StudySky could not find a clear page boundary. Use the manual crop controls instead.'
    );
  }
  return corners;
}

function cornerBackground(image: ImageData): [number, number, number] {
  const { width, height, data } = image;
  const patchWidth = Math.max(2, Math.floor(width * 0.08));
  const patchHeight = Math.max(2, Math.floor(height * 0.08));
  const red: number[] = [];
  const green: number[] = [];
  const blue: number[] = [];
  for (const [startX, startY] of [
    [0, 0],
    [width - patchWidth, 0],
    [0, height - patchHeight],
    [width - patchWidth, height - patchHeight]
  ]) {
    for (let y = startY; y < startY + patchHeight; y += 2) {
      for (let x = startX; x < startX + patchWidth; x += 2) {
        const offset = (y * width + x) * 4;
        red.push(data[offset]);
        green.push(data[offset + 1]);
        blue.push(data[offset + 2]);
      }
    }
  }
  return [median(red), median(green), median(blue)];
}

function colourDistanceMap(
  image: ImageData,
  [backgroundRed, backgroundGreen, backgroundBlue]: [number, number, number]
) {
  const output = new Uint8Array(image.width * image.height);
  for (let index = 0; index < output.length; index += 1) {
    const offset = index * 4;
    const red = image.data[offset] - backgroundRed;
    const green = image.data[offset + 1] - backgroundGreen;
    const blue = image.data[offset + 2] - backgroundBlue;
    output[index] = Math.min(255, Math.round(Math.hypot(red, green, blue)));
  }
  return output;
}

function otsuThreshold(values: Uint8Array) {
  const histogram = new Uint32Array(256);
  let totalSum = 0;
  for (const value of values) {
    histogram[value] += 1;
    totalSum += value;
  }
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let best = 0;
  for (let threshold = 0; threshold < 256; threshold += 1) {
    backgroundWeight += histogram[threshold];
    if (!backgroundWeight) continue;
    const foregroundWeight = values.length - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += threshold * histogram[threshold];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (totalSum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = threshold;
    }
  }
  return best;
}

function dilate(mask: Uint8Array, width: number, height: number) {
  const output = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      output[index] =
        mask[index - width - 1] |
        mask[index - width] |
        mask[index - width + 1] |
        mask[index - 1] |
        mask[index] |
        mask[index + 1] |
        mask[index + width - 1] |
        mask[index + width] |
        mask[index + width + 1];
    }
  }
  return output;
}

function erode(mask: Uint8Array, width: number, height: number) {
  const output = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      output[index] =
        mask[index - width - 1] &
        mask[index - width] &
        mask[index - width + 1] &
        mask[index - 1] &
        mask[index] &
        mask[index + 1] &
        mask[index + width - 1] &
        mask[index + width] &
        mask[index + width + 1];
    }
  }
  return output;
}

function largestComponent(mask: Uint8Array, width: number, height: number): number[] {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let largest: number[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    const component: number[] = [];
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const index = queue[head++];
      component.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if ((!offsetX && !offsetY) || x + offsetX < 0 || x + offsetX >= width) continue;
          if (y + offsetY < 0 || y + offsetY >= height) continue;
          const neighbour = index + offsetY * width + offsetX;
          if (mask[neighbour] && !visited[neighbour]) {
            visited[neighbour] = 1;
            queue[tail++] = neighbour;
          }
        }
      }
    }
    if (component.length > largest.length) largest = component;
  }
  return largest;
}

function componentCorners(component: number[], width: number, height: number): ScanCorner[] {
  let minimumSum = Infinity;
  let maximumSum = -Infinity;
  let minimumDifference = Infinity;
  let maximumDifference = -Infinity;
  for (const index of component) {
    const x = index % width;
    const y = Math.floor(index / width);
    minimumSum = Math.min(minimumSum, x + y);
    maximumSum = Math.max(maximumSum, x + y);
    minimumDifference = Math.min(minimumDifference, y - x);
    maximumDifference = Math.max(maximumDifference, y - x);
  }
  const tolerance = Math.max(3, (width + height) * 0.008);
  return [
    averageExtreme(component, width, (x, y) => x + y <= minimumSum + tolerance),
    averageExtreme(component, width, (x, y) => y - x <= minimumDifference + tolerance),
    averageExtreme(component, width, (x, y) => x + y >= maximumSum - tolerance),
    averageExtreme(component, width, (x, y) => y - x >= maximumDifference - tolerance)
  ];
}

function averageExtreme(
  component: number[],
  width: number,
  include: (x: number, y: number) => boolean
): ScanCorner {
  let xSum = 0;
  let ySum = 0;
  let count = 0;
  for (const index of component) {
    const x = index % width;
    const y = Math.floor(index / width);
    if (!include(x, y)) continue;
    xSum += x;
    ySum += y;
    count += 1;
  }
  return { x: xSum / Math.max(1, count), y: ySum / Math.max(1, count) };
}

async function warpPage(
  canvas: OffscreenCanvas,
  corners: [ScanCorner, ScanCorner, ScanCorner, ScanCorner]
): Promise<Blob> {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  const width = Math.max(distance(topLeft, topRight), distance(bottomLeft, bottomRight));
  const height = Math.max(distance(topLeft, bottomLeft), distance(topRight, bottomRight));
  if (width < 180 || height < 180) {
    throw new Error('The detected page boundary is too small to correct safely.');
  }
  const scale = Math.min(1, 2_000 / Math.max(width, height));
  const outputWidth = Math.max(1, Math.round(width * scale));
  const outputHeight = Math.max(1, Math.round(height * scale));
  const sourceContext = canvas.getContext('2d', { willReadFrequently: true });
  if (!sourceContext) throw new Error('Canvas processing is unavailable in this browser.');
  const source = sourceContext.getImageData(0, 0, canvas.width, canvas.height);
  const output = new ImageData(outputWidth, outputHeight);
  const transform = squareToQuadrilateral(corners);

  for (let y = 0; y < outputHeight; y += 1) {
    const vertical = y / Math.max(1, outputHeight - 1);
    for (let x = 0; x < outputWidth; x += 1) {
      const horizontal = x / Math.max(1, outputWidth - 1);
      const denominator =
        transform.perspectiveX * horizontal + transform.perspectiveY * vertical + 1;
      const sourceX =
        (transform.horizontalX * horizontal + transform.verticalX * vertical + topLeft.x) /
        denominator;
      const sourceY =
        (transform.horizontalY * horizontal + transform.verticalY * vertical + topLeft.y) /
        denominator;
      copyBilinearPixel(source, output, sourceX, sourceY, x, y);
    }
  }

  const outputCanvas = new OffscreenCanvas(outputWidth, outputHeight);
  const outputContext = outputCanvas.getContext('2d', { alpha: false });
  if (!outputContext) throw new Error('Canvas processing is unavailable in this browser.');
  outputContext.putImageData(output, 0, 0);
  return outputCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
}

function squareToQuadrilateral([topLeft, topRight, bottomRight, bottomLeft]: [
  ScanCorner,
  ScanCorner,
  ScanCorner,
  ScanCorner
]) {
  const deltaX1 = topRight.x - bottomRight.x;
  const deltaX2 = bottomLeft.x - bottomRight.x;
  const deltaX3 = topLeft.x - topRight.x + bottomRight.x - bottomLeft.x;
  const deltaY1 = topRight.y - bottomRight.y;
  const deltaY2 = bottomLeft.y - bottomRight.y;
  const deltaY3 = topLeft.y - topRight.y + bottomRight.y - bottomLeft.y;
  const denominator = deltaX1 * deltaY2 - deltaX2 * deltaY1;
  const perspectiveX =
    Math.abs(denominator) < 1e-8 ? 0 : (deltaX3 * deltaY2 - deltaX2 * deltaY3) / denominator;
  const perspectiveY =
    Math.abs(denominator) < 1e-8 ? 0 : (deltaX1 * deltaY3 - deltaX3 * deltaY1) / denominator;
  return {
    horizontalX: topRight.x - topLeft.x + perspectiveX * topRight.x,
    verticalX: bottomLeft.x - topLeft.x + perspectiveY * bottomLeft.x,
    horizontalY: topRight.y - topLeft.y + perspectiveX * topRight.y,
    verticalY: bottomLeft.y - topLeft.y + perspectiveY * bottomLeft.y,
    perspectiveX,
    perspectiveY
  };
}

function copyBilinearPixel(
  source: ImageData,
  destination: ImageData,
  sourceX: number,
  sourceY: number,
  destinationX: number,
  destinationY: number
) {
  const left = Math.max(0, Math.min(source.width - 1, Math.floor(sourceX)));
  const top = Math.max(0, Math.min(source.height - 1, Math.floor(sourceY)));
  const right = Math.min(source.width - 1, left + 1);
  const bottom = Math.min(source.height - 1, top + 1);
  const xWeight = Math.max(0, Math.min(1, sourceX - left));
  const yWeight = Math.max(0, Math.min(1, sourceY - top));
  const destinationOffset = (destinationY * destination.width + destinationX) * 4;
  for (let channel = 0; channel < 3; channel += 1) {
    const topValue =
      source.data[(top * source.width + left) * 4 + channel] * (1 - xWeight) +
      source.data[(top * source.width + right) * 4 + channel] * xWeight;
    const bottomValue =
      source.data[(bottom * source.width + left) * 4 + channel] * (1 - xWeight) +
      source.data[(bottom * source.width + right) * 4 + channel] * xWeight;
    destination.data[destinationOffset + channel] =
      topValue * (1 - yWeight) + bottomValue * yWeight;
  }
  destination.data[destinationOffset + 3] = 255;
}

function drawScaledBitmap(bitmap: ImageBitmap, maximumSide: number) {
  const scale = Math.min(1, maximumSide / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(bitmap.width * scale)),
    Math.max(1, Math.round(bitmap.height * scale))
  );
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas processing is unavailable in this browser.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function polygonArea(points: ScanCorner[]) {
  return Math.abs(
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2
  );
}

function distance(first: ScanCorner, second: ScanCorner) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function median(values: number[]) {
  values.sort((first, second) => first - second);
  return values[Math.floor(values.length / 2)] ?? 0;
}

function safeStem(filename: string) {
  return (
    filename
      .replace(/\.[^.]+$/, '')
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100) || 'scan'
  );
}

// Pure bezier path geometry for the stream — spec §8: "ลำธารไหลจากขวาบนลงซ้ายล่าง
// ตาม bezier path ใน stream.ts". Normalized 0..1 coordinates, fit to the
// viewport's actual aspect ratio at render time (plan §2.1 Q4: boats sit at
// the bottom edge in both orientations, so landscape just gets a longer,
// flatter stream — no separate layout branch is needed).

export interface NormalizedPoint {
  readonly x: number;
  readonly y: number;
}

/** Cubic bezier control points: P0 (upper right) -> P3 (lower left). */
const P0: NormalizedPoint = { x: 0.92, y: 0.06 };
const P1: NormalizedPoint = { x: 0.68, y: 0.22 };
const P2: NormalizedPoint = { x: 0.32, y: 0.58 };
const P3: NormalizedPoint = { x: 0.05, y: 0.88 };

const CUBIC_MID_COEFF = 3;

/** The stream's position at progress `t` (0 = source, 1 = mouth), in normalized 0..1 space. */
export function pointAtT(t: number): NormalizedPoint {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  const a = mt2 * mt;
  const b = CUBIC_MID_COEFF * mt2 * t;
  const c = CUBIC_MID_COEFF * mt * t2;
  const d = t2 * t;
  return {
    x: a * P0.x + b * P1.x + c * P2.x + d * P3.x,
    y: a * P0.y + b * P1.y + c * P2.y + d * P3.y,
  };
}

export interface ViewportFit {
  readonly width: number;
  readonly height: number;
  toPixels(p: NormalizedPoint): NormalizedPoint;
}

/** Scales normalized coordinates to a viewport's pixel size — no aspect-ratio correction, so a wide viewport just stretches the stream. */
export function fitToViewport(width: number, height: number): ViewportFit {
  return {
    width,
    height,
    toPixels: (p) => ({ x: p.x * width, y: p.y * height }),
  };
}

const DEFAULT_LENGTH_SAMPLES = 64;

/** Approximates the stream's on-screen length in pixels for a given viewport fit, by summing short chords. */
export function estimatePathLengthPx(fit: ViewportFit, samples = DEFAULT_LENGTH_SAMPLES): number {
  let length = 0;
  let prev = fit.toPixels(pointAtT(0));
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const next = fit.toPixels(pointAtT(t));
    length += Math.hypot(next.x - prev.x, next.y - prev.y);
    prev = next;
  }
  return length;
}

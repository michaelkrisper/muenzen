import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { before, describe, test } from 'node:test';

const require = createRequire(import.meta.url);
const { detectCoins } = require('../detect.js');
const { classify } = require('../classify.js');

let cv;
before(async () => {
  cv = require('../vendor/opencv.js');
  if (!cv.Mat) await new Promise((resolve) => (cv.onRuntimeInitialized = resolve));
  // The Emscripten module is "thenable" and would block every await.
  delete cv.then;
});

// Draws discs with core and ring on a light grey background, slightly noisy.
function render(width, height, discs) {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff - 0.5) * 8;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rgb = [205, 207, 212];
      for (const d of discs) {
        const dist = Math.hypot(x - d.x, y - d.y);
        if (dist <= d.r) rgb = dist < d.r * (d.core ?? 0) ? d.inner : d.outer;
      }
      const i = (y * width + x) * 4;
      const n = noise();
      data[i] = rgb[0] + n;
      data[i + 1] = rgb[1] + n;
      data[i + 2] = rgb[2] + n;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

const COPPER = [170, 98, 72];
const GOLD = [200, 165, 80];
const SILVER = [186, 186, 182];
const PX_PER_MM = 4;
const disc = (x, y, d, outer, inner = outer, core = 0) => ({
  x,
  y,
  r: (d * PX_PER_MM) / 2,
  outer,
  inner,
  core,
});

const DISCS = [
  disc(120, 120, 16.25, COPPER), // 1 Cent
  disc(300, 120, 21.25, COPPER), // 5 Cent
  disc(480, 120, 19.75, GOLD), // 10 Cent
  disc(660, 120, 24.25, GOLD), // 50 Cent
  disc(200, 330, 23.25, GOLD, SILVER, 0.7), // 1 Euro
  disc(420, 330, 25.75, SILVER, GOLD, 0.73), // 2 Euro
];

describe('detectCoins', () => {
  test('finds all discs with an accurate radius', () => {
    const coins = detectCoins(cv, render(800, 450, DISCS));
    assert.equal(coins.length, DISCS.length);
    for (const d of DISCS) {
      const hit = coins.find((c) => Math.hypot(c.x - d.x, c.y - d.y) < d.r * 0.2);
      assert.ok(hit, `no coin at ${d.x},${d.y}`);
      // Size separates the denominations by only about 5 %, so the radius must be more accurate.
      assert.ok(Math.abs(hit.r / d.r - 1) < 0.025, `radius ${hit.r.toFixed(1)} instead of ${d.r}`);
    }
  });

  test('end to end: denominations and amount', () => {
    const coins = detectCoins(cv, render(800, 450, DISCS));
    const order = DISCS.map((d) => coins.findIndex((c) => Math.hypot(c.x - d.x, c.y - d.y) < d.r * 0.2));
    const { labels, total } = classify(coins);
    assert.deepEqual(
      order.map((i) => labels[i]),
      ['1c', '5c', '10c', '50c', '1e', '2e'],
    );
    assert.equal(total, 366);
  });

  test('empty background yields no coins', () => {
    assert.equal(detectCoins(cv, render(400, 300, [])).length, 0);
  });
});

// Assigns euro coins to detected circles: colour (copper, brass,
// bimetal) from the measurement, size via one common scale for the
// whole image. No OpenCV, so it reruns instantly after corrections.

// Diameters in mm according to the ECB.
const COINS = [
  { id: '1c', label: '1 Cent', value: 1, d: 16.25, metal: 'copper' },
  { id: '2c', label: '2 Cent', value: 2, d: 18.75, metal: 'copper' },
  { id: '5c', label: '5 Cent', value: 5, d: 21.25, metal: 'copper' },
  { id: '10c', label: '10 Cent', value: 10, d: 19.75, metal: 'gold' },
  { id: '20c', label: '20 Cent', value: 20, d: 22.25, metal: 'gold' },
  { id: '50c', label: '50 Cent', value: 50, d: 24.25, metal: 'gold' },
  { id: '1e', label: '1 Euro', value: 100, d: 23.25, metal: 'bi1' },
  { id: '2e', label: '2 Euro', value: 200, d: 25.75, metal: 'bi2' },
];
const COIN_BY_ID = Object.fromEntries(COINS.map((c) => [c.id, c]));

// Spread of the measured diameter relative to the true one (Hough error,
// phone held slightly tilted).
const SIZE_SIGMA = 0.035;

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
// "Warmth" of an area: brass and copper lie clearly in the yellow in Lab
// space (b > 0), nickel silver near zero. Copper also counts via its red.
const warmth = (o) => o.b + 0.3 * Math.max(o.a, 0);
const hue = (a, b) => (Math.atan2(b, a) * 180) / Math.PI;

// Euro coins are silver (hardly any colour), brass or copper coloured. A
// clearly pink, red or blue circle is skin, paper or fabric. Copper sits
// at about 40°, skin and pink banknotes below 25°; under greenish light
// brass reaches up to about 120°.
const METAL_HUE = [25, 135];
const SILVER_CHROMA = 12;
function looksMetallic(o) {
  const h = hue(o.a, o.b);
  return Math.hypot(o.a, o.b) <= SILVER_CHROMA || (h >= METAL_HUE[0] && h <= METAL_HUE[1]);
}

// Probability per metal from inner and outer colour. The bimetal threshold
// follows the typical warmth of the coins in the image, which partly
// compensates for lighting and white balance.
function metalProbs(c, typicalWarmth) {
  const thr = Math.max(5, 0.4 * typicalWarmth);
  const dw = warmth(c.inner) - warmth(c.outer);
  const bi2 = sigmoid((dw - thr) / (0.25 * thr));
  const bi1 = sigmoid((-dw - thr) / (0.25 * thr));
  const mono = Math.max(0, 1 - bi1 - bi2);
  const h = hue((c.inner.a + c.outer.a) / 2, (c.inner.b + c.outer.b) / 2);
  const copper = sigmoid((52 - h) / 4);
  const p = { copper: mono * copper, gold: mono * (1 - copper), bi1, bi2 };
  // Floor, so that a very clear size can overrule the colour.
  for (const k in p) p[k] = Math.max(p[k], 0.02);
  return p;
}

// Scale (pixels per mm) at a coin's position. A tilted phone shows nearer
// coins larger; the scale then grows roughly linearly across the image.
// field: { s, gx, gy, cx, cy, span }.
function scaleAt(field, c) {
  return field.s * (1 + (field.gx * (c.x - field.cx) + field.gy * (c.y - field.cy)) / field.span);
}

function sizeCost(c, coin, s) {
  const z = ((2 * c.r) / s - coin.d) / (coin.d * SIZE_SIGMA);
  return (z * z) / 2;
}

function best(c, probs, s) {
  let bestCoin = null,
    bestCost = Infinity;
  for (const coin of COINS) {
    const k = -Math.log(probs[coin.metal]) + sizeCost(c, coin, s);
    if (k < bestCost) {
      bestCost = k;
      bestCoin = coin;
    }
  }
  return { coin: bestCoin, cost: bestCost };
}

// Cost above which a coin counts as a false detection (about five standard
// deviations off). It still enters the scale search, capped, so that a
// button or shadow does not distort the scale.
const OUTLIER_COST = 12.5;

// Tilt needs enough coins, otherwise it explains real size differences away.
const MIN_COINS_FOR_TILT = 6;
const TILT_SIGMA = 0.15;

// Centre and half extent of the coins, the reference for the tilt.
function extent(coins) {
  const xs = coins.map((c) => c.x);
  const ys = coins.map((c) => c.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, span: Math.max(x1 - x0, y1 - y0, 1) / 2 };
}

// Metal probabilities of all coins; the bimetal threshold depends on the
// typical warmth of the measured coins in the image.
function colorProbs(coins, measured) {
  const warmths = measured.map((c) => Math.max(warmth(c.inner), warmth(c.outer))).sort((a, b) => a - b);
  const typical = warmths[warmths.length >> 1] ?? 0;
  const uniform = { copper: 1, gold: 1, bi1: 1, bi2: 1 };
  return coins.map((c) => (c.inner ? metalProbs(c, typical) : uniform));
}

// Best scale field from a list of candidates; also returns all scores.
function minimize(fields, cost) {
  let best = null;
  const tried = fields.map((f) => {
    const t = cost(f);
    if (!best || t < best.t) best = { f, t };
    return { f, t };
  });
  return { field: best.f, total: best.t, tried };
}

const range = (from, to, step) =>
  Array.from({ length: Math.round((to - from) / step) + 1 }, (_, k) => from + k * step);

// coins: [{x, y, r, inner, outer}], fixed: [id|null] denominations set by the user.
function classify(coins, fixed = []) {
  if (!coins.length) return { labels: [], field: null, total: 0, ambiguous: false, outliers: [] };
  // Coins added by hand have neither colour nor a real radius.
  const measured = coins.filter((c) => c.inner);
  const probs = colorProbs(coins, measured);
  const anchors = fixed.map((id) => COIN_BY_ID[id] ?? null);
  const base = extent(measured);

  // Fixed coins count only with their own denomination, and without colour.
  const totalCost = (field) =>
    coins.reduce(
      (sum, c, i) => {
        if (!c.inner) return sum;
        const s = scaleAt(field, c);
        return (
          sum + (anchors[i] ? sizeCost(c, anchors[i], s) : Math.min(best(c, probs[i], s).cost, OUTLIER_COST))
        );
      },
      (field.gx ** 2 + field.gy ** 2) / (2 * TILT_SIGMA ** 2),
    );
  const labelsAt = (f) =>
    coins.map((c, i) => (anchors[i] ? anchors[i].id : best(c, probs[i], scaleAt(f, c)).coin.id));
  const sum = (labels) => labels.reduce((acc, id) => acc + COIN_BY_ID[id].value, 0);

  // Every coin/denomination pair yields a candidate scale.
  const fixedIdx = coins.map((c, i) => (anchors[i] && c.inner ? i : -1)).filter((i) => i >= 0);
  const candidates = fixedIdx.length
    ? fixedIdx.map((i) => (2 * coins[i].r) / anchors[i].d)
    : measured.flatMap((c) => COINS.map((coin) => (2 * c.r) / coin.d));
  if (!candidates.length) candidates.push(1);

  const flat = minimize(
    candidates.flatMap((s0) =>
      range(-3, 3, 1).map((k) => ({ ...base, s: s0 * (1 + k * 0.01), gx: 0, gy: 0 })),
    ),
    totalCost,
  );

  // If a clearly different scale fits almost as well and gives a different
  // amount, the size cannot be determined (e.g. only brass coins of equal
  // size). The user then has to fix one coin.
  const flatSum = sum(labelsAt(flat.field));
  const ambiguous =
    !fixedIdx.length &&
    flat.tried.some(
      ({ f, t }) =>
        Math.abs(f.s / flat.field.s - 1) > 0.07 && t - flat.total < 2 && sum(labelsAt(f)) !== flatSum,
    );

  let field = flat.field;
  if (measured.length >= MIN_COINS_FOR_TILT) {
    const tilts = range(-0.3, 0.3, 0.05).flatMap((gx) =>
      range(-0.3, 0.3, 0.05).flatMap((gy) =>
        range(-6, 6, 1).map((k) => ({ ...base, s: flat.field.s * (1 + k * 0.01), gx, gy })),
      ),
    );
    const tilted = minimize(tilts, totalCost);
    if (tilted.total < flat.total) field = tilted.field;
  }

  const labels = labelsAt(field);
  const outliers = coins
    .map((c, i) =>
      c.inner && !anchors[i] && best(c, probs[i], scaleAt(field, c)).cost > OUTLIER_COST ? i : -1,
    )
    .filter((i) => i >= 0);
  return { labels, field, total: sum(labels), ambiguous, outliers };
}

// Removes false detections of the circle search: first by colour, then circles
// whose size fits no coin. Runs once after detection, before corrections.
function dropNonCoins(coins) {
  const metallic = coins.filter((c) => !c.inner || (looksMetallic(c.inner) && looksMetallic(c.outer)));
  const { outliers } = classify(metallic);
  return metallic.filter((_c, i) => !outliers.includes(i));
}

if (typeof module !== 'undefined') module.exports = { COINS, COIN_BY_ID, classify, dropNonCoins };

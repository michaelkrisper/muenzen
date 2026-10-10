// Ordnet erkannten Kreisen Euro-Münzen zu: Farbe (Kupfer, Messing,
// Bimetall) aus der Messung, Größe über einen gemeinsamen Maßstab für das
// ganze Bild. Ohne OpenCV, damit es auch nach Korrekturen sofort neu läuft.

// Durchmesser in mm laut EZB.
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

// Streuung des gemessenen Durchmessers relativ zum echten (Hough-Fehler,
// leichte Schräglage beim Fotografieren).
const SIZE_SIGMA = 0.035;

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
// "Wärme" einer Fläche: Messing und Kupfer liegen im Lab-Raum deutlich im
// Gelben (b > 0), Neusilber nahe null. Kupfer zählt über seinen Rotanteil mit.
const warmth = (o) => o.b + 0.3 * Math.max(o.a, 0);
const hue = (a, b) => (Math.atan2(b, a) * 180) / Math.PI;

// Wahrscheinlichkeit je Metallsorte aus Innen- und Außenfarbe. Die Schwelle
// für Bimetall richtet sich nach der typischen Wärme der Münzen im Bild, so
// gleicht sich Licht und Weißabgleich zum Teil aus.
function metalProbs(c, typicalWarmth) {
  const thr = Math.max(5, 0.4 * typicalWarmth);
  const dw = warmth(c.inner) - warmth(c.outer);
  const bi2 = sigmoid((dw - thr) / (0.25 * thr));
  const bi1 = sigmoid((-dw - thr) / (0.25 * thr));
  const mono = Math.max(0, 1 - bi1 - bi2);
  const h = hue((c.inner.a + c.outer.a) / 2, (c.inner.b + c.outer.b) / 2);
  const copper = sigmoid((52 - h) / 4);
  const p = { copper: mono * copper, gold: mono * (1 - copper), bi1, bi2 };
  // Untergrenze, damit eine sehr eindeutige Größe die Farbe überstimmen kann.
  for (const k in p) p[k] = Math.max(p[k], 0.02);
  return p;
}

// Maßstab (Pixel je mm) an der Stelle einer Münze. Ein schräg gehaltenes
// Handy bildet nähere Münzen größer ab; über die Bildfläche wächst der
// Maßstab dann ungefähr linear. field: { s, gx, gy, cx, cy, span }.
function scaleAt(field, c) {
  return field.s * (1 + (field.gx * (c.x - field.cx) + field.gy * (c.y - field.cy)) / field.span);
}

function sizeCost(c, coin, s) {
  const z = ((2 * c.r) / s - coin.d) / (coin.d * SIZE_SIGMA);
  return (z * z) / 2;
}

function best(c, probs, s) {
  let bestCoin = null, bestCost = Infinity;
  for (const coin of COINS) {
    const k = -Math.log(probs[coin.metal]) + sizeCost(c, coin, s);
    if (k < bestCost) { bestCost = k; bestCoin = coin; }
  }
  return { coin: bestCoin, cost: bestCost };
}

// Neigung braucht genug Münzen, sonst erklärt sie Größenunterschiede weg.
const MIN_COINS_FOR_TILT = 6;
const TILT_SIGMA = 0.15;

// coins: [{x, y, r, inner, outer}], fixed: [id|null] vom Benutzer festgelegte Sorten.
function classify(coins, fixed = []) {
  if (!coins.length) return { labels: [], field: null, total: 0, ambiguous: false };
  // Von Hand hinzugefügte Münzen haben weder Farbe noch echten Radius.
  const measured = coins.filter((c) => c.inner);
  const warmths = measured.map((c) => Math.max(warmth(c.inner), warmth(c.outer))).sort((a, b) => a - b);
  const typical = warmths[warmths.length >> 1] ?? 0;
  const uniform = { copper: 1, gold: 1, bi1: 1, bi2: 1 };
  const probs = coins.map((c) => (c.inner ? metalProbs(c, typical) : uniform));
  const anchors = coins.map((c, i) => (fixed[i] && COIN_BY_ID[fixed[i]]) || null);

  const xs = measured.map((c) => c.x), ys = measured.map((c) => c.y);
  const base = {
    cx: (Math.min(...xs) + Math.max(...xs)) / 2,
    cy: (Math.min(...ys) + Math.max(...ys)) / 2,
    span: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1) / 2,
  };

  // Festgelegte Münzen zählen nur mit ihrer eigenen Sorte, dafür ohne Farbe.
  const totalCost = (field) => coins.reduce((sum, c, i) => {
    if (!c.inner) return sum;
    const s = scaleAt(field, c);
    return sum + (anchors[i] ? sizeCost(c, anchors[i], s) : best(c, probs[i], s).cost);
  }, (field.gx ** 2 + field.gy ** 2) / (2 * TILT_SIGMA ** 2));

  // Jede Paarung Münze/Sorte liefert einen Kandidaten für den Maßstab.
  const fixedIdx = anchors.map((a, i) => (a && coins[i].inner ? i : -1)).filter((i) => i >= 0);
  const candidates = fixedIdx.length
    ? fixedIdx.map((i) => (2 * coins[i].r) / anchors[i].d)
    : measured.flatMap((c) => COINS.map((coin) => (2 * c.r) / coin.d));
  if (!candidates.length) candidates.push(1);

  let field = { ...base, s: candidates[0], gx: 0, gy: 0 }, bestTotal = Infinity;
  const tried = [];
  for (const s0 of candidates) {
    for (let k = -3; k <= 3; k++) {
      const f = { ...base, s: s0 * (1 + k * 0.01), gx: 0, gy: 0 };
      const t = totalCost(f);
      tried.push({ f, t });
      if (t < bestTotal) { bestTotal = t; field = f; }
    }
  }

  // Passt ein deutlich anderer Maßstab fast genauso gut und ergibt einen
  // anderen Betrag, lässt sich die Größe nicht bestimmen (z. B. nur
  // gleich große Messingmünzen). Dann muss der Benutzer eine festlegen.
  const labelsAt = (f) => coins.map((c, i) => anchors[i] ? anchors[i].id : best(c, probs[i], scaleAt(f, c)).coin.id);
  const sum = (labels) => labels.reduce((acc, id) => acc + COIN_BY_ID[id].value, 0);
  let ambiguous = false;
  if (!fixedIdx.length) {
    const flatTotal = sum(labelsAt(field));
    ambiguous = tried.some(({ f, t }) => Math.abs(f.s / field.s - 1) > 0.07 && t - bestTotal < 2
      && sum(labelsAt(f)) !== flatTotal);
  }

  if (measured.length >= MIN_COINS_FOR_TILT) {
    const flat = field;
    for (let gx = -0.3; gx <= 0.301; gx += 0.05) {
      for (let gy = -0.3; gy <= 0.301; gy += 0.05) {
        for (let k = -6; k <= 6; k++) {
          const f = { ...base, s: flat.s * (1 + k * 0.01), gx, gy };
          const t = totalCost(f);
          if (t < bestTotal) { bestTotal = t; field = f; }
        }
      }
    }
  }

  const labels = labelsAt(field);
  return { labels, field, total: sum(labels), ambiguous };
}

if (typeof module !== 'undefined') module.exports = { COINS, COIN_BY_ID, classify };

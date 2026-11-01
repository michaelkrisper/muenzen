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

// Euro-Münzen sind silbern (kaum Farbe), messing- oder kupferfarben. Ein
// deutlich rosa, roter oder blauer Kreis ist Haut, Papier oder Stoff. Kupfer
// liegt bei etwa 40°, Haut und rosa Banknoten unter 25°; Messing reicht bei
// grünstichigem Licht bis gegen 120°.
const METAL_HUE = [25, 135];
const SILVER_CHROMA = 12;
function looksMetallic(o) {
  const h = hue(o.a, o.b);
  return Math.hypot(o.a, o.b) <= SILVER_CHROMA || (h >= METAL_HUE[0] && h <= METAL_HUE[1]);
}

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

// Kosten, ab denen eine Münze als Fehltreffer gilt (etwa fünf
// Standardabweichungen daneben). Gedeckelt geht sie auch so in die
// Maßstabssuche ein, damit ein Knopf oder Schatten den Maßstab nicht verzieht.
const OUTLIER_COST = 12.5;

// Neigung braucht genug Münzen, sonst erklärt sie Größenunterschiede weg.
const MIN_COINS_FOR_TILT = 6;
const TILT_SIGMA = 0.15;

// Mittelpunkt und halbe Ausdehnung der Münzen, Bezug für die Neigung.
function extent(coins) {
  const xs = coins.map((c) => c.x);
  const ys = coins.map((c) => c.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, span: Math.max(x1 - x0, y1 - y0, 1) / 2 };
}

// Metallwahrscheinlichkeiten aller Münzen; die Bimetall-Schwelle hängt von
// der typischen Wärme der gemessenen Münzen im Bild ab.
function colorProbs(coins, measured) {
  const warmths = measured.map((c) => Math.max(warmth(c.inner), warmth(c.outer))).sort((a, b) => a - b);
  const typical = warmths[warmths.length >> 1] ?? 0;
  const uniform = { copper: 1, gold: 1, bi1: 1, bi2: 1 };
  return coins.map((c) => (c.inner ? metalProbs(c, typical) : uniform));
}

// Bestes Maßstabsfeld aus einer Kandidatenliste; liefert alle Bewertungen mit.
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

// coins: [{x, y, r, inner, outer}], fixed: [id|null] vom Benutzer festgelegte Sorten.
function classify(coins, fixed = []) {
  if (!coins.length) return { labels: [], field: null, total: 0, ambiguous: false, outliers: [] };
  // Von Hand hinzugefügte Münzen haben weder Farbe noch echten Radius.
  const measured = coins.filter((c) => c.inner);
  const probs = colorProbs(coins, measured);
  const anchors = fixed.map((id) => COIN_BY_ID[id] ?? null);
  const base = extent(measured);

  // Festgelegte Münzen zählen nur mit ihrer eigenen Sorte, dafür ohne Farbe.
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

  // Jede Paarung Münze/Sorte liefert einen Kandidaten für den Maßstab.
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

  // Passt ein deutlich anderer Maßstab fast genauso gut und ergibt einen
  // anderen Betrag, lässt sich die Größe nicht bestimmen (z. B. nur
  // gleich große Messingmünzen). Dann muss der Benutzer eine festlegen.
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

// Fehltreffer der Kreissuche entfernen: erst nach Farbe, dann Kreise, deren
// Größe zu keiner Münze passt. Läuft einmal nach der Erkennung, vor Korrekturen.
function dropNonCoins(coins) {
  const metallic = coins.filter((c) => !c.inner || (looksMetallic(c.inner) && looksMetallic(c.outer)));
  const { outliers } = classify(metallic);
  return metallic.filter((_c, i) => !outliers.includes(i));
}

if (typeof module !== 'undefined') module.exports = { COINS, COIN_BY_ID, classify, dropNonCoins };

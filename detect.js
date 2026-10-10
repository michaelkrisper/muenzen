// Kreissuche und Farbmessung mit OpenCV.js. Läuft im Worker (importScripts)
// und unter Node für die Tests, deshalb kein ES-Modul.

// Arbeitsgröße: die längere Bildseite wird darauf verkleinert. Mehr bringt
// für die Hough-Suche kaum Genauigkeit, kostet aber deutlich Rechenzeit.
const WORK_SIZE = 1000;

// Größter Anteil, um den sich zwei Kreise überdecken dürfen, bevor der
// schwächere verworfen wird. Münzen liegen nebeneinander, nicht übereinander.
const MAX_OVERLAP = 0.35;

function detectCoins(cv, image, opts = {}) {
  const sensitivity = opts.sensitivity ?? 0.5;
  const scale = Math.min(1, WORK_SIZE / Math.max(image.width, image.height));
  const w = Math.round(image.width * scale);
  const h = Math.round(image.height * scale);

  const rgba = cv.matFromImageData(image);
  const rgb = new cv.Mat();
  cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
  rgba.delete();
  if (scale < 1) cv.resize(rgb, rgb, new cv.Size(w, h), 0, 0, cv.INTER_AREA);

  const gray = new cv.Mat();
  cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
  cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 1.5);

  const minDim = Math.min(w, h);
  const circlesMat = new cv.Mat();
  // HOUGH_GRADIENT_ALT: param2 ist die geforderte Kreisförmigkeit (0..1).
  const perfectness = 0.92 - 0.2 * sensitivity;
  cv.HoughCircles(gray, circlesMat, cv.HOUGH_GRADIENT_ALT, 1.5, minDim * 0.03,
    300, perfectness, Math.round(minDim * 0.025), Math.round(minDim * 0.35));

  let circles = [];
  for (let i = 0; i < circlesMat.cols; i++) {
    const [x, y, r] = circlesMat.data32F.slice(i * 3, i * 3 + 3);
    circles.push({ x, y, r });
  }
  circlesMat.delete();

  const gx = new cv.Mat(), gy = new cv.Mat();
  cv.Sobel(gray, gx, cv.CV_32F, 1, 0, 3);
  cv.Sobel(gray, gy, cv.CV_32F, 0, 1, 3);
  gray.delete();
  circles = removeOverlaps(circles.map((c) => refineCircle(gx, gy, c)));
  gx.delete();
  gy.delete();

  const lab = new cv.Mat();
  cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab);
  rgb.delete();
  const result = circles.map((c) => ({
    x: c.x / scale,
    y: c.y / scale,
    r: c.r / scale,
    inner: sampleLab(lab, c, 0, 0.5),
    outer: sampleLab(lab, c, 0.8, 0.93),
  }));
  lab.delete();
  return result;
}

function removeOverlaps(circles) {
  // Größere Kreise zuerst, damit eine Münze nicht von ihrem eigenen Innenring
  // (bei 1 und 2 Euro deutlich sichtbar) verdrängt wird.
  const sorted = [...circles].sort((a, b) => b.r - a.r);
  const kept = [];
  for (const c of sorted) {
    const clash = kept.some((k) => {
      const d = Math.hypot(k.x - c.x, k.y - c.y);
      const overlap = (k.r + c.r - d) / (2 * Math.min(k.r, c.r));
      return overlap > MAX_OVERLAP;
    });
    if (!clash) kept.push(c);
  }
  return kept;
}

// Hough liefert Radien auf einige Prozent genau; für die Unterscheidung der
// Münzgrößen reicht das nicht. Deshalb entlang von Strahlen die stärkste
// Kante suchen und durch diese Punkte einen Kreis legen.
function refineCircle(gx, gy, c) {
  const n = 90;
  const pts = [];
  const W = gx.cols, H = gx.rows;
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n;
    const ux = Math.cos(t), uy = Math.sin(t);
    let bestG = 0, bestR = 0;
    for (let rr = c.r * 0.8; rr <= c.r * 1.2; rr += 0.5) {
      const x = Math.round(c.x + ux * rr), y = Math.round(c.y + uy * rr);
      if (x < 0 || y < 0 || x >= W || y >= H) break;
      const i = y * W + x;
      const g = Math.abs(gx.data32F[i] * ux + gy.data32F[i] * uy);
      if (g > bestG) { bestG = g; bestR = rr; }
    }
    if (bestG > 0) pts.push({ x: c.x + ux * bestR, y: c.y + uy * bestR, g: bestG });
  }
  if (pts.length < n / 2) return c;

  // Schwache Kanten (Nachbarmünze, Schatten, Bildrand) zuerst aussortieren.
  const gMed = median(pts.map((p) => p.g));
  let use = pts.filter((p) => p.g >= gMed * 0.4);
  let fit = fitCircle(use);
  if (!fit) return c;
  const res = use.map((p) => Math.abs(Math.hypot(p.x - fit.x, p.y - fit.y) - fit.r));
  const resMed = median(res);
  use = use.filter((p, i) => res[i] <= Math.max(1.5, resMed * 2.5));
  fit = use.length >= n / 3 ? fitCircle(use) : null;
  if (!fit) return c;
  if (Math.abs(fit.r - c.r) > c.r * 0.2 || Math.hypot(fit.x - c.x, fit.y - c.y) > c.r * 0.2) return c;
  return fit;
}

// Algebraischer Kreisausgleich (Kåsa): x² + y² + Dx + Ey + F = 0.
function fitCircle(pts) {
  if (pts.length < 3) return null;
  let mx = 0, my = 0;
  for (const p of pts) { mx += p.x; my += p.y; }
  mx /= pts.length; my /= pts.length;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p.x - mx, v = p.y - my;
    suu += u * u; svv += v * v; suv += u * v;
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null;
  const a = (suuu + suvv) / 2, b = (svvv + svuu) / 2;
  const uc = (a * svv - b * suv) / det, vc = (b * suu - a * suv) / det;
  return { x: uc + mx, y: vc + my, r: Math.sqrt(uc * uc + vc * vc + (suu + svv) / pts.length) };
}

// Median von L, a, b im Ring zwischen r0 und r1 (Anteile des Radius).
// Median statt Mittelwert, weil Glanzlichter sonst die Farbe ausbleichen.
function sampleLab(lab, c, r0, r1) {
  const L = [], A = [], B = [];
  const rOut = c.r * r1, rIn = c.r * r0;
  const step = Math.max(1, Math.floor(c.r / 25));
  const x0 = Math.max(0, Math.floor(c.x - rOut)), x1 = Math.min(lab.cols - 1, Math.ceil(c.x + rOut));
  const y0 = Math.max(0, Math.floor(c.y - rOut)), y1 = Math.min(lab.rows - 1, Math.ceil(c.y + rOut));
  const data = lab.data;
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      const d = Math.hypot(x - c.x, y - c.y);
      if (d < rIn || d > rOut) continue;
      const i = (y * lab.cols + x) * 3;
      L.push(data[i]);
      A.push(data[i + 1] - 128);
      B.push(data[i + 2] - 128);
    }
  }
  return { L: median(L) / 2.55, a: median(A), b: median(B) };
}

function median(values) {
  if (!values.length) return 0;
  const s = Float64Array.from(values).sort();
  return s[s.length >> 1];
}

if (typeof module !== 'undefined') module.exports = { detectCoins };

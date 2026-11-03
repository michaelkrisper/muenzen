// Circle search and colour measurement with OpenCV.js. Runs in the worker
// (importScripts) and under Node for the tests, hence no ES module.

// Working size: the longer image side is scaled down to this. More adds
// hardly any accuracy to the Hough search but costs a lot of time.
const WORK_SIZE = 1000;

// Largest fraction by which two circles may overlap before the weaker one
// is dropped. Coins lie next to each other, not on top of each other.
const MAX_OVERLAP = 0.35;

// Upper Canny threshold. OpenCV's suggestion for HOUGH_GRADIENT_ALT (300)
// misses silver coins on a light background; 100 was best on the test photos.
const CANNY_HIGH = 100;

// Required circularity for HOUGH_GRADIENT_ALT (0..1). On the test photos
// 0.82 to 0.87 did equally well; stricter misses coins, looser gives
// false detections.
const PERFECTNESS = 0.82;

function detectCoins(cv, image) {
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
  cv.HoughCircles(
    gray,
    circlesMat,
    cv.HOUGH_GRADIENT_ALT,
    1.5,
    minDim * 0.03,
    CANNY_HIGH,
    PERFECTNESS,
    Math.round(minDim * 0.025),
    Math.round(minDim * 0.35),
  );

  let circles = [];
  for (let i = 0; i < circlesMat.cols; i++) {
    const [x, y, r] = circlesMat.data32F.slice(i * 3, i * 3 + 3);
    circles.push({ x, y, r });
  }
  circlesMat.delete();

  const gx = new cv.Mat(),
    gy = new cv.Mat();
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
  // Larger circles first, so a coin is not displaced by its own inner ring
  // (clearly visible on 1 and 2 euro coins).
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

// Hough gives radii to within a few percent; not enough to tell the coin
// sizes apart. So search the strongest edge along rays and fit a circle
// through those points.
function refineCircle(gx, gy, c) {
  const n = 90;
  const pts = [];
  const W = gx.cols,
    H = gx.rows;
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n;
    const ux = Math.cos(t),
      uy = Math.sin(t);
    let bestG = 0,
      bestR = 0;
    for (let rr = c.r * 0.8; rr <= c.r * 1.2; rr += 0.5) {
      const x = Math.round(c.x + ux * rr),
        y = Math.round(c.y + uy * rr);
      if (x < 0 || y < 0 || x >= W || y >= H) break;
      const i = y * W + x;
      const g = Math.abs(gx.data32F[i] * ux + gy.data32F[i] * uy);
      if (g > bestG) {
        bestG = g;
        bestR = rr;
      }
    }
    if (bestG > 0) pts.push({ x: c.x + ux * bestR, y: c.y + uy * bestR, g: bestG });
  }
  if (pts.length < n / 2) return c;

  // Drop weak edges (neighbouring coin, shadow, image border) first.
  const gMed = median(pts.map((p) => p.g));
  let use = pts.filter((p) => p.g >= gMed * 0.4);
  let fit = fitCircle(use);
  if (!fit) return c;
  const res = use.map((p) => Math.abs(Math.hypot(p.x - fit.x, p.y - fit.y) - fit.r));
  const resMed = median(res);
  use = use.filter((_p, i) => res[i] <= Math.max(1.5, resMed * 2.5));
  fit = use.length >= n / 3 ? fitCircle(use) : null;
  if (!fit) return c;
  if (Math.abs(fit.r - c.r) > c.r * 0.2 || Math.hypot(fit.x - c.x, fit.y - c.y) > c.r * 0.2) return c;
  return fit;
}

// Algebraic circle fit (Kåsa): x² + y² + Dx + Ey + F = 0.
function fitCircle(pts) {
  if (pts.length < 3) return null;
  let mx = 0,
    my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= pts.length;
  my /= pts.length;
  let suu = 0,
    svv = 0,
    suv = 0,
    suuu = 0,
    svvv = 0,
    suvv = 0,
    svuu = 0;
  for (const p of pts) {
    const u = p.x - mx,
      v = p.y - my;
    suu += u * u;
    svv += v * v;
    suv += u * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null;
  const a = (suuu + suvv) / 2,
    b = (svvv + svuu) / 2;
  const uc = (a * svv - b * suv) / det,
    vc = (b * suu - a * suv) / det;
  return { x: uc + mx, y: vc + my, r: Math.sqrt(uc * uc + vc * vc + (suu + svv) / pts.length) };
}

// Median of L, a, b in the ring between r0 and r1 (fractions of the radius).
// Median rather than mean, because highlights would otherwise bleach the colour.
function sampleLab(lab, c, r0, r1) {
  const L = [],
    A = [],
    B = [];
  const rOut = c.r * r1,
    rIn = c.r * r0;
  const step = Math.max(1, Math.floor(c.r / 25));
  const x0 = Math.max(0, Math.floor(c.x - rOut)),
    x1 = Math.min(lab.cols - 1, Math.ceil(c.x + rOut));
  const y0 = Math.max(0, Math.floor(c.y - rOut)),
    y1 = Math.min(lab.rows - 1, Math.ceil(c.y + rOut));
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

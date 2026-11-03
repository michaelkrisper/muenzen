// Try detection on photos: node tools/try.js photo.jpg [...]
// Writes <name>.out.jpg with the coins drawn in next to each photo.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { detectCoins } = require('../detect.js');
const { classify, dropNonCoins } = require('../classify.js');

function loadImage(file) {
  const [w, h] = execFileSync('magick', ['identify', '-auto-orient', '-format', '%w %h', file])
    .toString()
    .split(' ')
    .map(Number);
  const raw = execFileSync('magick', [file, '-auto-orient', '-depth', '8', 'rgba:-'], { maxBuffer: 1 << 30 });
  return { data: new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.length), width: w, height: h };
}

async function loadCv() {
  const cv = require('../vendor/opencv.js');
  // The Emscripten module is itself "thenable"; returned directly, await
  // would keep resolving it forever.
  if (!cv.Mat)
    await new Promise((r) => {
      cv.onRuntimeInitialized = r;
    });
  delete cv.then;
  return cv;
}

(async () => {
  const cv = await loadCv();
  for (const file of process.argv.slice(2)) {
    const img = loadImage(file);
    const t = Date.now();
    const coins = dropNonCoins(detectCoins(cv, img));
    const ms = Date.now() - t;
    const { labels, total } = classify(coins);
    console.log(`\n${path.basename(file)}: ${coins.length} coins, ${(total / 100).toFixed(2)} EUR, ${ms} ms`);
    const draw = [];
    coins.forEach((c, i) => {
      const f = (o) => `L${o.L.toFixed(0)} a${o.a.toFixed(0)} b${o.b.toFixed(0)}`;
      console.log(`#${i} r=${c.r.toFixed(0)} in[${f(c.inner)}] out[${f(c.outer)}] -> ${labels[i]}`);
      draw.push(
        '-stroke',
        'red',
        '-strokewidth',
        '3',
        '-fill',
        'none',
        '-draw',
        `circle ${c.x},${c.y} ${c.x + c.r},${c.y}`,
        '-stroke',
        'none',
        '-fill',
        'yellow',
        '-pointsize',
        String(Math.max(14, c.r * 0.5)),
        '-draw',
        `text ${c.x - c.r * 0.6},${c.y} '${i}:${labels[i]}'`,
      );
    });
    const out = file.replace(/\.[^.]+$/, '.out.jpg');
    execFileSync('magick', [file, '-auto-orient', ...draw, out]);
  }
})();

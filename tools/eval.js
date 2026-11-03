// Checks detection against ground truth: node tools/eval.js truth.json
// truth.json: { "photo.jpg": [[x, y, denomination|null], ...] }, paths relative to the file.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { detectCoins } = require('../detect.js');
const { classify, dropNonCoins } = require('../classify.js');

(async () => {
  const cv = require('../vendor/opencv.js');
  if (!cv.Mat)
    await new Promise((r) => {
      cv.onRuntimeInitialized = r;
    });
  delete cv.then;
  const truthFile = process.argv[2];
  const truth = JSON.parse(fs.readFileSync(truthFile, 'utf8'));
  let found = 0,
    total = 0,
    right = 0,
    labelled = 0,
    extra = 0;
  for (const [name, expected] of Object.entries(truth)) {
    const file = path.join(path.dirname(truthFile), name);
    const [w, h] = execFileSync('magick', ['identify', '-format', '%w %h', file])
      .toString()
      .split(' ')
      .map(Number);
    const raw = execFileSync('magick', [file, '-depth', '8', 'rgba:-'], { maxBuffer: 1 << 30 });
    const coins = dropNonCoins(detectCoins(cv, { data: new Uint8ClampedArray(raw), width: w, height: h }));
    const { labels } = classify(coins);
    const used = new Set();
    const wrong = [];
    for (const [x, y, want] of expected) {
      total++;
      const i = coins.findIndex((c, k) => !used.has(k) && Math.hypot(c.x - x, c.y - y) < c.r * 0.5);
      if (i < 0) {
        wrong.push(`(${x},${y}) missing`);
        continue;
      }
      used.add(i);
      found++;
      if (!want) continue;
      labelled++;
      if (labels[i] === want) right++;
      else wrong.push(`(${x},${y}) ${labels[i]} instead of ${want}`);
    }
    extra += coins.length - used.size;
    console.log(`${name}: ${coins.length} detected, ${coins.length - used.size} extra; ${wrong.join('; ')}`);
  }
  console.log(`\nFound ${found}/${total}, extra ${extra}, correct ${right}/${labelled}`);
})();

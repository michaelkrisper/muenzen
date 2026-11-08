# CLAUDE.md

Münzzähler: installable web app that counts euro coins in a photo and shows count,
total and a breakdown, entirely on the device. Vanilla JS, no framework, no build
step: the files in the repo root are served as they are. Detection runs OpenCV.js
(`vendor/opencv.js`, 4.12, ~11 MB) in a Web Worker. CI publishes to GitHub Pages
(https://michaelkrisper.github.io/muenzen/). UI German.

## Commands

Node 26 (`.nvmrc`), Google Chrome for the browser test. `tools/` also needs Python 3
with NumPy and ImageMagick (`magick`).

```sh
npm ci
npm run serve                  # python3 -m http.server 8080
npm run lint                   # Biome check (npm run lint:fix applies fixes)
npm test                       # node:test unit tests, incl. detection with real OpenCV
npm run test:e2e               # headless Chrome: fixture photo -> 20 coins, 1106 cents,
                               # tap-to-correct, offline cache complete
pipx run ruff check tools && pipx run ruff format --check tools
node tools/try.js photo.jpg    # detection on your own photo, writes photo.out.jpg
node tools/eval.js truth.json  # hit rate vs ground truth {"photo.jpg": [[x, y, "50c"], ...]}
python3 tools/make-fixture.py out.jpg 7   # synthetic photo for seed 7, prints count and amount
node tools/stamp-sw.mjs _site  # stamps sw.js cache names (CI does this on deploy)
```

`ci.yml` job "Lint and tests" runs `npx biome ci`, Ruff, `npm test` and
`npm run test:e2e`; on `main` the "Version tag" job tags, then "GitHub Pages" copies
the app files into `_site/`, stamps `sw.js` and deploys.

## Architecture

- `index.html` loads `classify.js` and `app.js` as classic scripts (no ES modules).
  `app.js`: camera/file input, drawing, tap-to-correct dialog, share text.
- `worker.js` runs `importScripts('vendor/opencv.js', 'detect.js')` and answers
  detection requests; OpenCV never loads on the main thread.
- `detect.js` (needs `cv`): Hough circles (`HOUGH_GRADIENT_ALT`), overlap filter, rim
  re-measured along 90 rays with a Kåsa circle fit, L\*a\*b\* colour of core and ring.
- `classify.js` (no OpenCV): metal, one scale search over all coins (may grow linearly
  across the image for tilted shots), denomination, amount, ambiguity, non-coin filter.
- `detect.js` and `classify.js` end with `if (typeof module !== 'undefined') module.exports = …`
  so tests and `tools/` can `require` them. Cross-file globals are declared in
  `biome.json` (`overrides` -> `globals`); add new ones there.

## Service worker (`sw.js`)

- Two caches: `muenzen-shell-<hash>` (`SHELL`: app files, icons) and
  `muenzen-assets-<hash>` (`ASSETS`: `vendor/opencv.js`). The repo holds `-dev`
  instead of the hash; the deploy runs `tools/stamp-sw.mjs`, which hashes each list's
  files. A cache is renamed exactly when its files change. Never bump anything by hand.
- Install fetches only what a cache of the same name lacks (`cache: 'reload'`), so a
  code change downloads the shell (~160 KB), not OpenCV.js again.
- A new file the app needs: add it to `SHELL` (or `ASSETS` for large vendor files) and
  to the `cp` list of the deploy job's "Assemble site" step, which publishes only the
  listed files. `tests/stamp-sw.test.mjs` fails if a listed file does not exist.
- michaelkrisper.github.io is shared with other apps, and so is CacheStorage: every
  cache name starts with `muenzen-` and activate deletes only outdated `muenzen-`
  caches. Never delete caches by any other pattern.

## Conventions

- Biome (single quotes, 110 columns; `vendor/` and `tests/fixtures/` excluded), Ruff for
  `tools/*.py` (`pyproject.toml`). Dev dependency is Biome only; no runtime
  dependencies, no bundler, no framework.
- UI text German; code, comments, identifiers and commit messages English.
- `vendor/opencv.js` is unmodified upstream; update it as described in
  `vendor/README.md`.

## Rules and pitfalls

- Never commit photos by other authors (licences). Real test photos (e.g. Wikimedia
  Commons) stay outside the repo; the Commons API throttles quickly, fetch one file at
  a time with pauses. CI uses `tests/fixtures/coins.jpg` = `make-fixture.py` seed 1
  (20 coins, 11.06 euros); if you regenerate it, update the numbers in `test:e2e`.
- Detection changes need before/after numbers from `tools/eval.js` on photos with
  ground truth in the PR. The constants in `detect.js` are measured: `CANNY_HIGH` is
  100 because OpenCV's suggested 300 misses silver coins on light backgrounds.
- The Emscripten module is thenable; `worker.js` deletes `cv.then`, otherwise every
  `await` on it hangs. Keep that when touching the worker.
- Known weak spots: very dark copper coins, coins shot at a steep angle, stacked or
  touching piles. Never tested with real phone photos so far.

## Workflow

- Every change starts with a GitHub issue. Branch `<issue>-<slug>` from `main`,
  open a PR with `Closes #<issue>`. Never push to `main` directly.
- PRs auto-merge (squash) once CI and the "Linked ticket" check pass; drafts are not merged.
- Versions exist only as git tags `vX.Y.Z`. Every merge to `main` tags the next patch;
  never edit version numbers in files. Minor/major releases: Actions -> Release.
- Merging to `main` deploys to GitHub Pages automatically (CI workflow).
- Details: CONTRIBUTING.md.

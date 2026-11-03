# Contributing

Bug reports, photos with misdetections and pull requests are welcome.

## Setup

Requirements: Node.js 26 (see `.nvmrc`), Google Chrome (for the browser test), and for the
tools in `tools/` also Python 3 with NumPy and ImageMagick.

```sh
npm ci
npm run serve        # http://localhost:8080
```

There is no build step; the files in the repository root are the app.

## Before a pull request

```sh
npm run lint:fix     # Biome: format and lint
npm test             # unit tests (node:test)
npm run test:e2e     # end to end in headless Chrome
```

CI runs the same steps, plus Ruff for `tools/*.py`.

## Notes

- Changes to app files: bump `VERSION` in `sw.js`, otherwise the service
  worker keeps serving the old version.
- Check changes to detection with `tools/eval.js` against your own photos
  with ground truth and give the before/after numbers in the pull request.
- No photos by other authors in the repository; tests use
  `tools/make-fixture.py`.
- Commit messages, comments and identifiers in English; the user interface
  stays German.

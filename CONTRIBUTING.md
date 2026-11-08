# Contributing

Bug reports, photos with misdetections and pull requests are welcome.

## Workflow

1. Every change starts with an issue: a bug report or a feature request.
2. Work on a branch named after the issue. `gh issue develop <issue> --checkout`
   creates `<issue>-<title>`.
3. Open a pull request against `main`. The _Tickets_ check links the issue
   (`Closes #<issue>`); a pull request without a ticket fails.
4. CI runs on every pull request. When all checks are green, _Auto-merge_
   squash-merges it. Open the pull request as a draft while it is not ready.
5. The merge closes the issue. `main` always holds the latest valid state
   (trunk-based development).

## Versions and releases

- Versions follow [Semantic Versioning](https://semver.org) and exist only as
  git tags (`vMAJOR.MINOR.PATCH`).
- CI tags every merge to `main` with the next patch version.
- A release bundles the changes since the previous one: run
  _Actions → Release → Run workflow_ and pick `minor` or `major`. It tags
  `main` and publishes a GitHub release listing the merged pull requests and
  closed tickets.

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

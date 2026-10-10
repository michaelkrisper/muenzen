# Mitarbeiten

Fehlerberichte, Fotos mit Fehlerkennungen und Pull Requests sind willkommen.

## Einrichten

Voraussetzungen: Node.js 24, Google Chrome (für den Browsertest), für die
Werkzeuge in `tools/` außerdem Python 3 mit NumPy und ImageMagick.

```sh
npm ci
npm run serve        # http://localhost:8080
```

Es gibt keinen Build-Schritt; die Dateien im Hauptverzeichnis sind die App.

## Vor dem Pull Request

```sh
npm run lint:fix     # Biome: formatieren und linten
npm test             # Unit-Tests (node:test)
npm run test:e2e     # Ende-zu-Ende im headless Chrome
```

Die CI führt dieselben Schritte aus, dazu Ruff für `tools/*.py`.

## Hinweise

- Änderungen an App-Dateien: `VERSION` in `sw.js` hochzählen, sonst
  liefert der Service Worker weiter die alte Fassung aus.
- Änderungen an der Erkennung mit `tools/eval.js` gegen eigene Fotos mit
  Sollwerten prüfen und die Zahlen vorher/nachher im Pull Request nennen.
- Keine Fotos fremder Urheber ins Repo; für Tests gibt es
  `tools/make-fixture.py`.
- Commit-Nachrichten und Kommentare auf Deutsch, Code-Bezeichner auf Englisch.

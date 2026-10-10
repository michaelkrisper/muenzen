# Münzzähler

Euro-Münzen per Foto zählen: die App findet die Münzen im Bild, bestimmt
ihre Sorte und rechnet Anzahl und Gesamtwert aus. Läuft komplett im Browser,
auch offline; das Foto verlässt das Gerät nicht.

**App:** https://michaelkrisper.github.io/muenzen/

## Benutzung

1. Münzen nebeneinander auf einen einfarbigen, matten Untergrund legen.
2. Senkrecht von oben fotografieren, gleichmäßiges Licht, ohne Blitz.
3. Falsch erkannte Münzen antippen und die richtige Sorte wählen. Die
   übrigen Münzen werden danach neu bewertet, weil die festgelegte Münze
   den Maßstab vorgibt.
4. Fehlende Münzen über **+ Münze** ergänzen, Fehltreffer mit
   **Keine Münze** entfernen.

Auf dem Handy über „Zum Startbildschirm hinzufügen“ installieren.

## Wie es funktioniert

- **Kreise finden** (`detect.js`, im Worker): OpenCV.js `HoughCircles` mit
  `HOUGH_GRADIENT_ALT`, danach wird jeder Kreis an der stärksten Kante
  entlang von 90 Strahlen nachgemessen und neu angepasst. Hough allein ist für
  die Größenunterscheidung zu ungenau.
- **Farbe messen**: Median von L\*a\*b\* im Kern und im äußeren Ring. Daraus
  ergibt sich Kupfer (1, 2, 5 Cent), Messing (10, 20, 50 Cent) oder Bimetall
  (1 Euro: silberner Kern, 2 Euro: silberner Ring).
- **Größe** (`classify.js`): Das Foto hat keinen bekannten Maßstab. Die App
  sucht deshalb den Maßstab (Pixel je mm), bei dem alle Münzen zusammen am
  besten zu den echten Durchmessern passen, und erlaubt bei mindestens sechs
  Münzen einen linearen Verlauf über das Bild (schräg gehaltenes Handy).
- Liegen nur gleich große Münzen einer Farbe da (z. B. nur 10 Cent), ist der
  Maßstab nicht bestimmbar. Die App sagt das und bittet darum, eine Münze
  festzulegen.

Grenzen: übereinanderliegende Haufen, starke Spiegelungen, sehr dunkle oder
farbstichige Fotos und Münzen anderer Währungen.

## Entwicklung

Kein Build-Schritt. Lokal reicht ein statischer Server, z. B.
`python3 -m http.server`.

```sh
# Ende-zu-Ende im headless Chrome: Foto laden, Summe prüfen, Korrektur testen
node tests/browser-check.mjs tests/fixtures/coins.jpg 20 1106

# Künstliches Testfoto mit bekanntem Inhalt erzeugen (gibt Anzahl und Cent aus)
python3 tools/make-fixture.py /tmp/test.jpg 7

# Erkennung auf eigenen Fotos ansehen (schreibt <name>.out.jpg) bzw. gegen
# Sollwerte prüfen; braucht ImageMagick
node tools/try.js foto.jpg
node tools/eval.js truth.json
```

`vendor/opencv.js` ist OpenCV.js 4.12.0 aus dem npm-Paket
`@techstark/opencv-js` (Apache-2.0). Nach Änderungen an App-Dateien
`VERSION` in `sw.js` hochzählen, sonst bleibt die alte Fassung im Cache.

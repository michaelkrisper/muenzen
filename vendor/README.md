# Fremdcode

| Datei | Herkunft | Version | Lizenz |
|---|---|---|---|
| `opencv.js` | [OpenCV.js](https://docs.opencv.org/4.12.0/opencv.js) über das npm-Paket [`@techstark/opencv-js`](https://www.npmjs.com/package/@techstark/opencv-js) | 4.12.0 | Apache-2.0, siehe [`LICENSE-opencv.txt`](LICENSE-opencv.txt) |

Unverändert übernommen. Aktualisieren:

```sh
npm pack @techstark/opencv-js@<version>
tar xzf techstark-opencv-js-*.tgz package/dist/opencv.js
mv package/dist/opencv.js vendor/opencv.js
```

Danach `npm test` laufen lassen. Die Cache-Namen in `sw.js` stempelt CI beim Deploy
mit einem Inhalts-Hash; hochzählen ist nicht nötig.

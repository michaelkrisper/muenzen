// Bilderkennung im Hintergrund, damit das 10-MB-OpenCV die Oberfläche nicht
// blockiert, weder beim Laden noch beim Rechnen.
importScripts('vendor/opencv.js', 'detect.js');

const ready = new Promise((resolve) => {
  if (self.cv.Mat) resolve();
  else self.cv.onRuntimeInitialized = resolve;
}).then(() => {
  // Das Emscripten-Modul ist "thenable" und würde jedes await blockieren.
  delete self.cv.then;
  postMessage({ type: 'ready' });
});

self.onmessage = async (e) => {
  const { id, image } = e.data;
  await ready;
  try {
    postMessage({ type: 'result', id, coins: detectCoins(self.cv, image) });
  } catch (err) {
    postMessage({ type: 'error', id, message: String(err?.message ?? err) });
  }
};

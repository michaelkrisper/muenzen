// Image recognition in the background, so the 10 MB OpenCV build blocks the
// UI neither while loading nor while computing.
importScripts('vendor/opencv.js', 'detect.js');

const ready = new Promise((resolve) => {
  if (self.cv.Mat) resolve();
  else self.cv.onRuntimeInitialized = resolve;
}).then(() => {
  // The Emscripten module is "thenable" and would block every await.
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

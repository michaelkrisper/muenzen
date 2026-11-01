// Oberfläche: Foto laden, Erkennung im Worker anstoßen, Ergebnis zeichnen
// und Korrekturen durch Antippen übernehmen. COINS, classify und
// dropNonCoins kommen aus classify.js.

// Anzeigegröße des Fotos; die Erkennung verkleinert intern weiter.
const DISPLAY_SIZE = 1600;

const COLORS = {
  copper: '#e07a45',
  gold: '#f2c230',
  bi1: '#9fd3ff',
  bi2: '#c6a0ff',
};

const $ = (id) => document.getElementById(id);
const euro = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' });

const state = {
  bitmap: null,
  coins: [], // { x, y, r, inner, outer } in Bildpunkten des Anzeigebilds
  fixed: [], // vom Benutzer gewählte Sorte je Münze oder null
  labels: [],
  adding: false,
  ambiguous: false,
  requestId: 0,
};

// --- Worker ---------------------------------------------------------------

const worker = new Worker('worker.js');
let engineReady = false;
const pending = new Map();

worker.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'ready') {
    engineReady = true;
    $('engine').textContent = 'Bereit. Funktioniert ab jetzt auch offline.';
    return;
  }
  const done = pending.get(msg.id);
  if (!done) return;
  pending.delete(msg.id);
  if (msg.type === 'result') done.resolve(msg.coins);
  else done.reject(new Error(msg.message));
};
worker.onerror = () => {
  $('engine').textContent = 'Die Bilderkennung konnte nicht geladen werden. Seite neu laden?';
};

function detect(imageData) {
  const id = ++state.requestId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, image: imageData }, [imageData.data.buffer]);
  });
}

// --- Foto laden -----------------------------------------------------------

for (const input of document.querySelectorAll('[data-photo]')) {
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (file) await loadPhoto(file);
  });
}

// --- Kamera ---------------------------------------------------------------

// Der Sucher startet gleich beim Öffnen; die Kamera-App des Handys ließe
// sich nur nach einem Antippen öffnen. Ohne Kamera oder Erlaubnis bleiben
// die Dateiknöpfe.
let stream = null;

async function startCamera() {
  if (stream || !navigator.mediaDevices?.getUserMedia) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'environment', width: { ideal: 4096 }, height: { ideal: 4096 } },
    });
  } catch {
    return;
  }
  // Inzwischen weitergeblättert oder ausgeblendet: gleich wieder freigeben.
  if ($('start').hidden || document.hidden) {
    stopCamera();
    return;
  }
  const video = $('camera');
  video.srcObject = stream;
  await video.play().catch(() => {});
  $('viewfinder').hidden = false;
  $('shutter').hidden = false;
  $('capture').hidden = true;
}

function stopCamera() {
  for (const track of stream?.getTracks() ?? []) track.stop();
  stream = null;
  $('camera').srcObject = null;
  $('viewfinder').hidden = true;
  $('shutter').hidden = true;
  $('capture').hidden = false;
}

$('shutter').addEventListener('click', async () => {
  const video = $('camera');
  if (!stream || !video.videoWidth) return;
  let source = video;
  // Chrome auf Android liefert über ImageCapture die volle Fotoauflösung,
  // sonst bleibt das aktuelle Videobild.
  if ('ImageCapture' in self) {
    try {
      source = await new ImageCapture(stream.getVideoTracks()[0]).takePhoto();
    } catch {
      /* Videobild verwenden */
    }
  }
  await loadPhoto(source);
});

$('again').addEventListener('click', () => {
  $('result').hidden = true;
  $('start').hidden = false;
  startCamera();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCamera();
  else if (!$('start').hidden) startCamera();
});

startCamera();

// source: Datei, Blob oder Videobild.
async function loadPhoto(source) {
  stopCamera();
  let bitmap;
  try {
    bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  } catch {
    alert('Dieses Bild kann der Browser nicht öffnen.');
    return;
  }
  const scale = Math.min(1, DISPLAY_SIZE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale),
    h = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  state.bitmap = canvas.transferToImageBitmap();

  $('start').hidden = true;
  $('result').hidden = false;
  setAdding(false);
  await runDetection();
}

async function runDetection() {
  const { bitmap } = state;
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

  state.coins = [];
  state.fixed = [];
  update();
  $('busy').hidden = false;
  $('busy').textContent = engineReady ? 'Suche Münzen …' : 'Bilderkennung wird geladen …';
  const id = state.requestId + 1;
  try {
    const coins = await detect(imageData);
    if (id !== state.requestId) return;
    state.coins = dropNonCoins(coins);
    state.fixed = state.coins.map(() => null);
  } catch (err) {
    console.error(err);
    alert('Bei der Erkennung ist etwas schiefgegangen.');
  } finally {
    if (id === state.requestId) $('busy').hidden = true;
  }
  update();
}

// --- Darstellung ----------------------------------------------------------

function update() {
  const { labels, total, ambiguous } = classify(state.coins, state.fixed);
  state.labels = labels;
  state.ambiguous = ambiguous;
  draw();
  showHint();

  const n = state.coins.length;
  $('sum').value = euro.format(total / 100);
  $('count').textContent = `${n} ${n === 1 ? 'Münze' : 'Münzen'}`;

  const rows = $('rows');
  rows.replaceChildren();
  for (const coin of [...COINS].reverse()) {
    const count = labels.filter((id) => id === coin.id).length;
    if (!count) continue;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><span class="dot" style="--c:${COLORS[coin.metal]}"></span>${coin.label}</td>
      <td class="num">${count} ×</td><td class="num">${euro.format((count * coin.value) / 100)}</td>`;
    rows.append(tr);
  }
}

function draw() {
  const canvas = $('photo');
  const { bitmap } = state;
  if (!bitmap) return;
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);

  // Linien- und Schriftgröße am angezeigten, nicht am echten Bild ausrichten.
  const px = bitmap.width / canvas.getBoundingClientRect().width || 1;
  state.coins.forEach((c, i) => {
    const coin = COIN_BY_ID[state.labels[i]];
    const color = COLORS[coin.metal];
    ctx.lineWidth = 3 * px;
    ctx.strokeStyle = color;
    ctx.setLineDash(state.fixed[i] ? [] : [8 * px, 5 * px]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, 2 * Math.PI);
    ctx.stroke();

    const text = coin.value < 100 ? `${coin.value}c` : `${coin.value / 100}€`;
    const size = Math.max(13 * px, Math.min(c.r * 0.55, 22 * px));
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    const tw = ctx.measureText(text).width;
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(15, 20, 30, 0.75)';
    ctx.beginPath();
    ctx.roundRect(c.x - tw / 2 - size * 0.35, c.y - size * 0.7, tw + size * 0.7, size * 1.4, size * 0.7);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, c.x, c.y + size * 0.05);
  });
}

window.addEventListener('resize', () => draw());

// --- Korrekturen ----------------------------------------------------------

function setAdding(on) {
  state.adding = on;
  $('add').setAttribute('aria-pressed', String(on));
  showHint();
}

function showHint() {
  const hint = $('hint');
  hint.classList.toggle('warn', !state.adding && state.ambiguous);
  if (state.adding) hint.textContent = 'Tippe auf die Stelle, an der eine Münze fehlt.';
  else if (state.ambiguous) {
    hint.textContent =
      'Die Größe ist nicht eindeutig, weil die Münzen zu ähnlich sind. ' +
      'Tippe eine Münze an und wähle ihre Sorte, die übrigen passen sich an.';
  } else hint.textContent = 'Münze antippen, um die Sorte zu ändern oder sie zu entfernen.';
}

$('add').addEventListener('click', () => setAdding(!state.adding));

$('photo').addEventListener('click', async (e) => {
  if (!state.bitmap) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * state.bitmap.width;
  const y = ((e.clientY - rect.top) / rect.height) * state.bitmap.height;

  if (state.adding) {
    setAdding(false);
    const radii = state.coins.map((c) => c.r).sort((a, b) => a - b);
    const r = radii.length
      ? radii[radii.length >> 1]
      : Math.min(state.bitmap.width, state.bitmap.height) * 0.06;
    state.coins.push({ x, y, r, manual: true });
    state.fixed.push(null);
    const i = state.coins.length - 1;
    const choice = await pick(i);
    if (choice === 'cancel' || choice === 'remove' || choice === 'auto') removeCoin(i);
    update();
    return;
  }

  // Nächstgelegene Münze, die den Punkt enthält (mit etwas Spielraum für Finger).
  let hit = -1,
    bestD = Infinity;
  state.coins.forEach((c, i) => {
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < c.r * 1.15 && d < bestD) {
      bestD = d;
      hit = i;
    }
  });
  if (hit < 0) return;
  const choice = await pick(hit);
  if (choice === 'remove') removeCoin(hit);
  else if (choice === 'auto') state.fixed[hit] = null;
  update();
});

function removeCoin(i) {
  state.coins.splice(i, 1);
  state.fixed.splice(i, 1);
}

// Öffnet die Auswahl; legt die gewählte Sorte direkt fest und liefert sonst
// 'remove', 'auto' oder 'cancel'.
function pick(i) {
  const dialog = $('picker');
  const choices = $('choices');
  choices.replaceChildren();
  for (const coin of COINS) {
    const b = document.createElement('button');
    b.value = coin.id;
    b.className = 'coin';
    b.style.setProperty('--c', COLORS[coin.metal]);
    if (coin.id === state.labels[i] && !state.coins[i].manual) b.classList.add('current');
    b.textContent = coin.label;
    choices.append(b);
  }
  // Selbst hinzugefügte Münzen haben keine Farbmessung, Automatik geht nicht.
  $('auto').hidden = !!state.coins[i].manual;
  dialog.returnValue = 'cancel';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        const v = dialog.returnValue || 'cancel';
        if (COIN_BY_ID[v]) {
          state.fixed[i] = v;
          resolve('set');
        } else {
          resolve(v);
        }
      },
      { once: true },
    );
  });
}

// Ein Tipp neben die Auswahl schließt den Dialog.
$('picker').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close('cancel');
});

// --- Teilen ---------------------------------------------------------------

$('share').addEventListener('click', async () => {
  const lines = [...$('rows').children].map((tr) =>
    [...tr.children].map((td) => td.textContent.trim()).join(' '),
  );
  const text = `${lines.join('\n')}\n= ${$('count').textContent}, ${$('sum').value}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Münzzähler', text });
    else {
      await navigator.clipboard.writeText(text);
      $('share').textContent = 'Kopiert';
      setTimeout(() => {
        $('share').textContent = 'Ergebnis teilen';
      }, 1500);
    }
  } catch {
    /* abgebrochen */
  }
});

// --- Offline ----------------------------------------------------------------

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

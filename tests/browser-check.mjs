/**
 * Ende-zu-Ende-Test im echten Browser: startet einen statischen Server, lädt
 * ein Foto über das Dateifeld, wartet auf die Erkennung und prüft Summe und
 * Anzahl. Korrigiert danach eine Münze über den Auswahldialog.
 *
 *   node tests/browser-check.mjs [foto.jpg] [erwartete Anzahl] [erwarteter Betrag in Cent]
 *
 * Chrome statt obscura: die App braucht Worker, WebAssembly und Canvas.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const photo = resolve(process.argv[2] ?? join(root, 'tests/fixtures/coins.jpg'));
const wantCount = process.argv[3] && Number(process.argv[3]);
const wantCents = process.argv[4] && Number(process.argv[4]);
const port = 9334;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  try {
    const body = readFileSync(join(root, path));
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}/`;

const profile = mkdtempSync(join(tmpdir(), 'muenzen-chrome-'));
const chrome = spawn('google-chrome', ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=420,900', 'about:blank'],
{ stdio: 'ignore' });

class Tab {
  #ws; #id = 0; #pending = new Map(); errors = [];

  static async open(url) {
    for (let i = 0; i < 50; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
        const tab = new Tab();
        await tab.#connect((await res.json()).webSocketDebuggerUrl);
        return tab;
      } catch { await wait(200); }
    }
    throw new Error('Chrome antwortet nicht');
  }

  #connect(url) {
    return new Promise((ok, fail) => {
      this.#ws = new WebSocket(url);
      this.#ws.addEventListener('message', (event) => {
        const m = JSON.parse(event.data);
        if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
        const done = this.#pending.get(m.id);
        if (done) { this.#pending.delete(m.id); done(m); }
      });
      this.#ws.addEventListener('open', ok);
      this.#ws.addEventListener('error', fail);
    });
  }

  async send(method, params = {}) {
    const id = ++this.#id;
    const m = await new Promise((ok) => { this.#pending.set(id, ok); this.#ws.send(JSON.stringify({ id, method, params })); });
    if (m.error) throw new Error(`${method}: ${m.error.message}`);
    return m.result;
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  async until(expression, timeout = 60000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await this.eval(expression)) return;
      await wait(200);
    }
    throw new Error(`Zeitüberschreitung: ${expression}`);
  }
}

let failed = false;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FEHLER'} ${msg}`); if (!ok) failed = true; };

try {
  const tab = await Tab.open('about:blank');
  await tab.send('Runtime.enable');
  await tab.send('Page.enable');
  await tab.send('DOM.enable');
  await tab.send('Page.navigate', { url: base });
  await tab.until(`document.getElementById('engine')?.textContent.startsWith('Bereit')`);
  check(true, 'Bilderkennung geladen');

  const { root: doc } = await tab.send('DOM.getDocument');
  const { nodeId } = await tab.send('DOM.querySelector', { nodeId: doc.nodeId, selector: '#start input[type=file]' });
  await tab.send('DOM.setFileInputFiles', { nodeId, files: [photo] });
  await tab.until(`!document.getElementById('result').hidden && document.getElementById('busy').hidden`);

  const count = await tab.eval(`state.coins.length`);
  const cents = await tab.eval(`classify(state.coins, state.fixed).total`);
  console.log(`     ${await tab.eval(`document.getElementById('count').textContent`)}, ${await tab.eval(`document.getElementById('sum').value`)}`);
  check(count > 0, 'Münzen erkannt');
  if (wantCount) check(count === wantCount, `Anzahl ${count}, erwartet ${wantCount}`);
  if (wantCents) check(cents === wantCents, `Betrag ${cents} Cent, erwartet ${wantCents}`);

  const shot = await tab.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(join(tmpdir(), 'muenzen-ergebnis.png'), Buffer.from(shot.data, 'base64'));

  // Erste Münze antippen und als 2 Euro festlegen.
  const pt = await tab.eval(`(() => { const c = state.coins[0]; const r = document.getElementById('photo').getBoundingClientRect();
    return { x: r.left + c.x / state.bitmap.width * r.width, y: r.top + c.y / state.bitmap.height * r.height }; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await tab.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  }
  await tab.until(`document.getElementById('picker').open`, 5000);
  await tab.eval(`document.querySelector('#choices button[value="2e"]').click()`);
  await tab.until(`!document.getElementById('picker').open`, 5000);
  // Das close-Ereignis des Dialogs kommt erst nach dem Schließen.
  await tab.until(`state.fixed[0] === '2e' && state.labels[0] === '2e'`, 5000);
  check(true, 'Korrektur übernommen');

  // Erst wenn alles im Cache liegt, ist die Installation durch.
  await tab.until(`navigator.serviceWorker.getRegistration().then((r) => r?.active?.state === 'activated')`, 30000);
  await tab.until(`caches.match('vendor/opencv.js').then(Boolean)`, 5000);
  check(true, 'Offline-Cache vollständig');

  check(tab.errors.length === 0, `keine Fehler in der Konsole${tab.errors.length ? ': ' + tab.errors.join(' | ') : ''}`);
} catch (err) {
  check(false, err.message);
} finally {
  chrome.kill();
  server.close();
  await wait(300);
  rmSync(profile, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);

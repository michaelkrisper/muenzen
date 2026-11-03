/**
 * End-to-end test in a real browser: starts a static server, loads a photo
 * through the file input, waits for detection and checks sum and count.
 * Then corrects one coin through the picker dialog and checks the offline cache.
 *
 *   node tests/browser-check.mjs [photo.jpg] [expected count] [expected amount in cents]
 *
 * Chrome rather than obscura: the app needs workers, WebAssembly and canvas.
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

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};
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
const chrome = spawn(
  'google-chrome',
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--window-size=420,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

class Tab {
  #ws;
  #id = 0;
  #pending = new Map();
  errors = [];

  static async open(url) {
    for (let i = 0; i < 50; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
          method: 'PUT',
        });
        const tab = new Tab();
        await tab.#connect((await res.json()).webSocketDebuggerUrl);
        return tab;
      } catch {
        await wait(200);
      }
    }
    throw new Error('Chrome does not respond');
  }

  #connect(url) {
    return new Promise((ok, fail) => {
      this.#ws = new WebSocket(url);
      this.#ws.addEventListener('message', (event) => {
        const m = JSON.parse(event.data);
        if (m.method === 'Runtime.exceptionThrown')
          this.errors.push(
            m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text,
          );
        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
          this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
        const done = this.#pending.get(m.id);
        if (done) {
          this.#pending.delete(m.id);
          done(m);
        }
      });
      this.#ws.addEventListener('open', ok);
      this.#ws.addEventListener('error', fail);
    });
  }

  async send(method, params = {}) {
    const id = ++this.#id;
    const m = await new Promise((ok) => {
      this.#pending.set(id, ok);
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
    if (m.error) throw new Error(`${method}: ${m.error.message}`);
    return m.result;
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  async until(expression, timeout = 60000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await this.eval(expression)) return;
      await wait(200);
    }
    throw new Error(`Timeout: ${expression}`);
  }
}

let failed = false;
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) failed = true;
};

try {
  const tab = await Tab.open('about:blank');
  await tab.send('Runtime.enable');
  await tab.send('Page.enable');
  await tab.send('DOM.enable');
  await tab.send('Page.navigate', { url: base });
  await tab.until(`document.getElementById('engine')?.textContent.startsWith('Bereit')`);
  check(true, 'recognition engine loaded');

  const { root: doc } = await tab.send('DOM.getDocument');
  const { nodeId } = await tab.send('DOM.querySelector', {
    nodeId: doc.nodeId,
    selector: '#start input[type=file]',
  });
  await tab.send('DOM.setFileInputFiles', { nodeId, files: [photo] });
  await tab.until(`!document.getElementById('result').hidden && document.getElementById('busy').hidden`);

  const count = await tab.eval(`state.coins.length`);
  const cents = await tab.eval(`classify(state.coins, state.fixed).total`);
  console.log(
    `     ${await tab.eval(`document.getElementById('count').textContent`)}, ${await tab.eval(`document.getElementById('sum').value`)}`,
  );
  check(count > 0, 'coins detected');
  if (wantCount) check(count === wantCount, `count ${count}, expected ${wantCount}`);
  if (wantCents) check(cents === wantCents, `amount ${cents} cents, expected ${wantCents}`);

  const shot = await tab.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(join(tmpdir(), 'muenzen-result.png'), Buffer.from(shot.data, 'base64'));

  // Tap the first coin and set it to 2 euros.
  const pt =
    await tab.eval(`(() => { const c = state.coins[0]; const r = document.getElementById('photo').getBoundingClientRect();
    return { x: r.left + c.x / state.bitmap.width * r.width, y: r.top + c.y / state.bitmap.height * r.height }; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await tab.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  }
  await tab.until(`document.getElementById('picker').open`, 5000);
  await tab.eval(`document.querySelector('#choices button[value="2e"]').click()`);
  await tab.until(`!document.getElementById('picker').open`, 5000);
  // The dialog's close event only fires after it has closed.
  await tab.until(`state.fixed[0] === '2e' && state.labels[0] === '2e'`, 5000);
  check(true, 'correction applied');

  // Installation is complete only once everything is cached.
  await tab.until(
    `navigator.serviceWorker.getRegistration().then((r) => r?.active?.state === 'activated')`,
    30000,
  );
  await tab.until(`caches.match('vendor/opencv.js').then(Boolean)`, 5000);
  check(true, 'offline cache complete');

  check(
    tab.errors.length === 0,
    `no console errors${tab.errors.length ? `: ${tab.errors.join(' | ')}` : ''}`,
  );
} catch (err) {
  check(false, err.message);
} finally {
  chrome.kill();
  server.close();
  await wait(300);
  rmSync(profile, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);

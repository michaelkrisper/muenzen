import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';

const { classify, dropNonCoins, COINS, COIN_BY_ID } = createRequire(import.meta.url)('../classify.js');

// Typische Lab-Werte aus echten Fotos.
const GOLD = { L: 60, a: 2, b: 30 };
const COPPER = { L: 50, a: 25, b: 20 };
const SILVER = { L: 70, a: 0, b: 2 };
const LOOK = {
  copper: [COPPER, COPPER],
  gold: [GOLD, GOLD],
  bi1: [SILVER, GOLD],
  bi2: [GOLD, SILVER],
};

// Münze der Sorte `id` bei `pxPerMm`, nebeneinander aufgereiht.
function coin(id, pxPerMm, x = 0, y = 0) {
  const { d, metal } = COIN_BY_ID[id];
  const [inner, outer] = LOOK[metal];
  return { x, y, r: (d * pxPerMm) / 2, inner, outer };
}

const row = (ids, pxPerMm = 4) => ids.map((id, i) => coin(id, pxPerMm, i * 150));

describe('classify', () => {
  test('leeres Bild', () => {
    assert.deepEqual(classify([]), {
      labels: [],
      field: null,
      total: 0,
      ambiguous: false,
      outliers: [],
    });
  });

  test('erkennt alle acht Sorten nebeneinander', () => {
    const ids = COINS.map((c) => c.id);
    const result = classify(row(ids));
    assert.deepEqual(result.labels, ids);
    assert.equal(result.total, 388);
    assert.equal(result.ambiguous, false);
  });

  test('Maßstab ist frei, nur die Verhältnisse zählen', () => {
    for (const pxPerMm of [1.5, 4, 11]) {
      assert.deepEqual(classify(row(['1c', '10c', '50c', '2e'], pxPerMm)).labels, ['1c', '10c', '50c', '2e']);
    }
  });

  test('einzelne Bimetallmünzen über die Farbe', () => {
    assert.deepEqual(classify(row(['1e'])).labels, ['1e']);
    assert.deepEqual(classify(row(['2e'])).labels, ['2e']);
  });

  test('Kupfermünzen nur über die Größe', () => {
    assert.deepEqual(classify(row(['1c', '2c', '5c', '2c'])).labels, ['1c', '2c', '5c', '2c']);
  });

  test('gleich große Messingmünzen sind mehrdeutig', () => {
    const result = classify(row(['20c', '20c', '20c']));
    assert.equal(result.ambiguous, true);
  });

  test('eine festgelegte Münze löst die Mehrdeutigkeit auf', () => {
    const coins = row(['10c', '10c', '10c']);
    const result = classify(coins, ['10c', null, null]);
    assert.deepEqual(result.labels, ['10c', '10c', '10c']);
    assert.equal(result.ambiguous, false);
  });

  test('festgelegte Münze gibt den Maßstab für die anderen vor', () => {
    // 50c und 20c sind beide Messing; ohne Anker könnte das Paar auch 20c/10c sein.
    const coins = row(['20c', '50c']);
    assert.deepEqual(classify(coins, [null, '50c']).labels, ['20c', '50c']);
  });

  test('von Hand ergänzte Münze ohne Farbmessung', () => {
    const coins = [...row(['1e', '2e']), { x: 400, y: 0, r: 999, manual: true }];
    const result = classify(coins, [null, null, '50c']);
    assert.deepEqual(result.labels, ['1e', '2e', '50c']);
    assert.equal(result.total, 350);
  });

  test('schräg fotografiert: Maßstab wächst über das Bild', () => {
    // Unten 20 % größer als oben; ohne Neigung würden die unteren Münzen
    // eine Stufe zu groß eingeordnet.
    const ids = ['10c', '20c', '50c', '10c', '20c', '50c', '1c', '5c'];
    const coins = ids.map((id, i) => {
      const y = (i % 4) * 200;
      return coin(id, 4 * (1 + y / 1000), (i >> 2) * 300, y);
    });
    assert.deepEqual(classify(coins).labels, ids);
  });
});

describe('dropNonCoins', () => {
  test('verwirft Kreise in Haut-, Rosa- und Blautönen', () => {
    const coins = row(['1c', '10c', '1e', '2e']);
    const skin = { x: 600, y: 0, r: 40, inner: { L: 70, a: 28, b: 9 }, outer: { L: 64, a: 30, b: 15 } };
    const paper = { x: 750, y: 0, r: 40, inner: { L: 76, a: -4, b: -12 }, outer: { L: 76, a: -4, b: -12 } };
    assert.deepEqual(dropNonCoins([...coins, skin, paper]), coins);
  });

  test('verwirft Kreise, deren Größe zu keiner Münze passt', () => {
    const coins = row(['1c', '5c', '10c', '50c', '1e', '2e']);
    // Silberner Knopf mit 8 mm: viel kleiner als jede Münze.
    const button = { x: 900, y: 0, r: 16, inner: SILVER, outer: SILVER };
    assert.deepEqual(dropNonCoins([...coins, button]), coins);
  });

  test('behält von Hand ergänzte Münzen', () => {
    const coins = [...row(['1e', '2e']), { x: 400, y: 0, r: 5, manual: true }];
    assert.deepEqual(dropNonCoins(coins), coins);
  });
});

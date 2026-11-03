import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';

const { classify, dropNonCoins, COINS, COIN_BY_ID } = createRequire(import.meta.url)('../classify.js');

// Typical Lab values from real photos.
const GOLD = { L: 60, a: 2, b: 30 };
const COPPER = { L: 50, a: 25, b: 20 };
const SILVER = { L: 70, a: 0, b: 2 };
const LOOK = {
  copper: [COPPER, COPPER],
  gold: [GOLD, GOLD],
  bi1: [SILVER, GOLD],
  bi2: [GOLD, SILVER],
};

// Coin of denomination `id` at `pxPerMm`, lined up side by side.
function coin(id, pxPerMm, x = 0, y = 0) {
  const { d, metal } = COIN_BY_ID[id];
  const [inner, outer] = LOOK[metal];
  return { x, y, r: (d * pxPerMm) / 2, inner, outer };
}

const row = (ids, pxPerMm = 4) => ids.map((id, i) => coin(id, pxPerMm, i * 150));

describe('classify', () => {
  test('empty image', () => {
    assert.deepEqual(classify([]), {
      labels: [],
      field: null,
      total: 0,
      ambiguous: false,
      outliers: [],
    });
  });

  test('recognises all eight denominations side by side', () => {
    const ids = COINS.map((c) => c.id);
    const result = classify(row(ids));
    assert.deepEqual(result.labels, ids);
    assert.equal(result.total, 388);
    assert.equal(result.ambiguous, false);
  });

  test('scale is free, only the ratios matter', () => {
    for (const pxPerMm of [1.5, 4, 11]) {
      assert.deepEqual(classify(row(['1c', '10c', '50c', '2e'], pxPerMm)).labels, ['1c', '10c', '50c', '2e']);
    }
  });

  test('single bimetal coins by colour', () => {
    assert.deepEqual(classify(row(['1e'])).labels, ['1e']);
    assert.deepEqual(classify(row(['2e'])).labels, ['2e']);
  });

  test('copper coins by size alone', () => {
    assert.deepEqual(classify(row(['1c', '2c', '5c', '2c'])).labels, ['1c', '2c', '5c', '2c']);
  });

  test('brass coins of equal size are ambiguous', () => {
    const result = classify(row(['20c', '20c', '20c']));
    assert.equal(result.ambiguous, true);
  });

  test('one fixed coin resolves the ambiguity', () => {
    const coins = row(['10c', '10c', '10c']);
    const result = classify(coins, ['10c', null, null]);
    assert.deepEqual(result.labels, ['10c', '10c', '10c']);
    assert.equal(result.ambiguous, false);
  });

  test('a fixed coin sets the scale for the others', () => {
    // 50c and 20c are both brass; without an anchor the pair could also be 20c/10c.
    const coins = row(['20c', '50c']);
    assert.deepEqual(classify(coins, [null, '50c']).labels, ['20c', '50c']);
  });

  test('coin added by hand without colour measurement', () => {
    const coins = [...row(['1e', '2e']), { x: 400, y: 0, r: 999, manual: true }];
    const result = classify(coins, [null, null, '50c']);
    assert.deepEqual(result.labels, ['1e', '2e', '50c']);
    assert.equal(result.total, 350);
  });

  test('photographed at an angle: scale grows across the image', () => {
    // 20 % larger at the bottom than at the top; without tilt the lower coins
    // would be classified one size too large.
    const ids = ['10c', '20c', '50c', '10c', '20c', '50c', '1c', '5c'];
    const coins = ids.map((id, i) => {
      const y = (i % 4) * 200;
      return coin(id, 4 * (1 + y / 1000), (i >> 2) * 300, y);
    });
    assert.deepEqual(classify(coins).labels, ids);
  });
});

describe('dropNonCoins', () => {
  test('drops circles in skin, pink and blue tones', () => {
    const coins = row(['1c', '10c', '1e', '2e']);
    const skin = { x: 600, y: 0, r: 40, inner: { L: 70, a: 28, b: 9 }, outer: { L: 64, a: 30, b: 15 } };
    const paper = { x: 750, y: 0, r: 40, inner: { L: 76, a: -4, b: -12 }, outer: { L: 76, a: -4, b: -12 } };
    assert.deepEqual(dropNonCoins([...coins, skin, paper]), coins);
  });

  test('drops circles whose size fits no coin', () => {
    const coins = row(['1c', '5c', '10c', '50c', '1e', '2e']);
    // Silver button of 8 mm: much smaller than any coin.
    const button = { x: 900, y: 0, r: 16, inner: SILVER, outer: SILVER };
    assert.deepEqual(dropNonCoins([...coins, button]), coins);
  });

  test('keeps coins added by hand', () => {
    const coins = [...row(['1e', '2e']), { x: 400, y: 0, r: 5, manual: true }];
    assert.deepEqual(dropNonCoins(coins), coins);
  });
});

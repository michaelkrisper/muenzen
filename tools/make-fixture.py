"""Creates a synthetic coin photo with known contents for the tests.

    python3 tools/make-fixture.py tests/fixtures/coins.jpg [seed]

Prints count and amount in cents. No real photos in the repo, because their
licences require attribution and CI does not need them.
"""

import subprocess
import sys

import numpy as np

# id, diameter mm, core fraction (bimetal), outer colour, core colour, value
COPPER = (176, 104, 62)
GOLD = (200, 165, 80)
SILVER = (186, 186, 182)
COINS = [
    ("1c", 16.25, 0, COPPER, COPPER, 1),
    ("2c", 18.75, 0, COPPER, COPPER, 2),
    ("5c", 21.25, 0, COPPER, COPPER, 5),
    ("10c", 19.75, 0, GOLD, GOLD, 10),
    ("20c", 22.25, 0, GOLD, GOLD, 20),
    ("50c", 24.25, 0, GOLD, GOLD, 50),
    ("1e", 23.25, 0.70, GOLD, SILVER, 100),
    ("2e", 25.75, 0.73, SILVER, GOLD, 200),
]


def main():
    out = sys.argv[1]
    rng = np.random.default_rng(int(sys.argv[2]) if len(sys.argv) > 2 else 1)
    w, h = 1600, 1200
    px_per_mm = 4.2
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)

    # Light grey cardboard with a slight brightness gradient and noise.
    img = np.empty((h, w, 3), np.float32)
    shade = 0.9 + 0.1 * (xx / w) - 0.05 * (yy / h)
    for k, v in enumerate((205, 207, 212)):
        img[..., k] = v * shade

    picks = [c for c in COINS for _ in range(2)] + [COINS[rng.integers(len(COINS))] for _ in range(4)]
    placed = []
    for coin in picks:
        r = coin[1] * px_per_mm / 2
        for _ in range(500):
            x, y = rng.uniform(r + 20, w - r - 20), rng.uniform(r + 20, h - r - 20)
            if all(np.hypot(x - px, y - py) > r + pr + 12 for px, py, pr, _ in placed):
                placed.append((x, y, r, coin))
                break

    for x, y, r, (_id, _d, core, outer, inner, _value) in placed:
        dist = np.hypot(xx - x, yy - y)
        # Shadow slightly towards the bottom right.
        sd = np.hypot(xx - x - r * 0.06, yy - y - r * 0.08)
        img *= (1 - 0.25 * np.clip((r * 1.04 - sd) / 3, 0, 1))[..., None]

        mask = np.clip(r - dist + 0.5, 0, 1)
        col = np.empty((h, w, 3), np.float32)
        is_core = dist < r * core
        for k in range(3):
            col[..., k] = np.where(is_core, inner[k], outer[k])
        # Light from the top left, darker rim, relief as fine noise.
        light = 0.85 + 0.25 * (-(xx - x) - (yy - y)) / (2 * r)
        rim = 1 - 0.18 * np.clip((dist - r * 0.88) / (r * 0.12), 0, 1)
        relief = 1 + 0.06 * rng.standard_normal((h, w)).astype(np.float32)
        col *= (light * rim * relief)[..., None]
        img = img * (1 - mask[..., None]) + col * mask[..., None]

    img += rng.normal(0, 3, img.shape)
    data = np.clip(img, 0, 255).astype(np.uint8)
    subprocess.run(
        ["magick", "-size", f"{w}x{h}", "-depth", "8", "rgb:-", "-blur", "0x0.8", "-quality", "88", out],
        input=data.tobytes(),
        check=True,
    )

    ids = [c[3][0] for c in placed]
    cents = sum(c[3][5] for c in placed)
    print(len(ids), cents, " ".join(sorted(ids)))


main()

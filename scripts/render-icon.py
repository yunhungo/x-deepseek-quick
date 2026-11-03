#!/usr/bin/env python3
"""Draw the DeepSeek Glass app icon.

The mark is an original frosted panel with two chat bubbles. It is not the
DeepSeek whale. macOS applies the squircle mask, so the artwork is full-bleed
and the symbol stays inside the center 80%.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
OUT = Path(__file__).resolve().parents[1] / "src-tauri" / "icons" / "source.png"


def lerp(a: int, b: int, t: float) -> int:
    return int(a + (b - a) * t)


def gradient() -> Image.Image:
    image = Image.new("RGBA", (SIZE, SIZE))
    pixels = image.load()
    for y in range(SIZE):
        for x in range(SIZE):
            t = (x * 0.35 + y * 0.65) / SIZE
            pixels[x, y] = (
                lerp(18, 6, t),
                lerp(72, 22, t),
                lerp(82, 32, t),
                255,
            )
    return image


def main() -> None:
    image = gradient()
    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((40, -80, 760, 640), fill=(186, 232, 238, 70))
    image = Image.alpha_composite(image, glow)

    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (176, 176, 848, 848),
        radius=120,
        fill=(255, 255, 255, 46),
        outline=(255, 255, 255, 150),
        width=3,
    )
    draw.rounded_rectangle(
        (248, 300, 620, 560),
        radius=92,
        fill=(244, 251, 252, 235),
    )
    draw.rounded_rectangle(
        (400, 470, 776, 730),
        radius=92,
        fill=(125, 211, 220, 235),
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUT)
    print(OUT)


if __name__ == "__main__":
    main()

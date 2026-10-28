#!/usr/bin/env python3
"""Generate the extension icons (16/32/48/128 PNG)."""

from PIL import Image, ImageDraw

SIZE = 512
COLOR_FROM = (91, 140, 255)
COLOR_TO = (139, 92, 246)


def gradient(size):
    image = Image.new('RGB', (size, size))
    pixels = image.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            pixels[x, y] = tuple(
                int(start + (end - start) * t)
                for start, end in zip(COLOR_FROM, COLOR_TO)
            )
    return image


def make_icon():
    base = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    mask = Image.new('L', (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, SIZE - 1, SIZE - 1], radius=112, fill=255
    )
    base.paste(gradient(SIZE), (0, 0), mask)

    draw = ImageDraw.Draw(base)
    white = (255, 255, 255, 255)

    # Mountains
    draw.polygon([(104, 376), (238, 236), (352, 376)], fill=white)
    draw.polygon([(262, 376), (338, 286), (408, 376)], fill=white)

    # Sun
    draw.ellipse([166, 176, 224, 234], fill=white)

    # Frame
    draw.rounded_rectangle(
        [96, 110, 416, 398], radius=44, outline=white, width=22
    )
    return base


def main():
    icon = make_icon()
    for size in (16, 32, 48, 128):
        icon.resize((size, size), Image.LANCZOS).save(
            f'icons/icon{size}.png', optimize=True
        )
    print('icons generated')


if __name__ == '__main__':
    main()

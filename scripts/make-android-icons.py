#!/usr/bin/env python3
"""Generates Android launcher icons (legacy + adaptive) and splash drawables
from assets/icon-only.png and assets/splash.png. Re-run after changing assets.
Requires: pip install pillow"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
icon = Image.open(os.path.join(ROOT, 'assets', 'icon-only.png')).convert('RGBA')
splash = Image.open(os.path.join(ROOT, 'assets', 'splash.png')).convert('RGBA')

DENS = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}

def save(img, rel):
    p = os.path.join(RES, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    img.save(p, 'PNG', optimize=True)

for name, k in DENS.items():
    legacy = round(48 * k)
    base = icon.resize((legacy, legacy), Image.LANCZOS).convert('RGB')
    save(base, f'mipmap-{name}/ic_launcher.png')
    mask = Image.new('L', (legacy, legacy), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, legacy - 1, legacy - 1), fill=255)
    rnd = Image.new('RGBA', (legacy, legacy), (0, 0, 0, 0))
    rnd.paste(base, (0, 0), mask)
    save(rnd, f'mipmap-{name}/ic_launcher_round.png')
    # Adaptive foreground: 108dp canvas, art inside the 72dp safe zone.
    fg_size = round(108 * k)
    art = round(fg_size * 0.62)
    canvas = Image.new('RGBA', (fg_size, fg_size), (0, 0, 0, 0))
    canvas.paste(icon.resize((art, art), Image.LANCZOS), ((fg_size - art) // 2, (fg_size - art) // 2))
    save(canvas, f'mipmap-{name}/ic_launcher_foreground.png')

# Splash: black square with the mark centred; CENTER_CROP handles the rest.
SPLASH_SIZES = {'mdpi': 480, 'hdpi': 800, 'xhdpi': 1280, 'xxhdpi': 1600, 'xxxhdpi': 1920}
for name, size in SPLASH_SIZES.items():
    art = round(size * 0.35)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 255))
    canvas.alpha_composite(splash.resize((art, art), Image.LANCZOS), ((size - art) // 2, (size - art) // 2))
    for orient in ('port', 'land'):
        save(canvas.convert('RGB'), f'drawable-{orient}-{name}/splash.png')

values = os.path.join(RES, "values", "ic_launcher_background.xml")
if os.path.exists(values):
    s = open(values, encoding='utf-8').read()
    import re
    s = re.sub(r'<color name="ic_launcher_background">[^<]*</color>',
               '<color name="ic_launcher_background">#000000</color>', s)
    open(values, 'w', encoding='utf-8').write(s)
print('android icons and splash written to', os.path.relpath(RES, ROOT))

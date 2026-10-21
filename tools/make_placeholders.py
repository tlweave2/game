#!/usr/bin/env python3
"""
Builds PLACEHOLDER clips and full-res placement stills from your Gemini images.

  python3 tools/make_placeholders.py art/canon .

Reads the canon images in art/canon (matched by file-name prefix):
  lobby_lasers_off, pod, hero_back, hero_reaction

The hero is cut out of his plain gray background and placed in the corridor
using the horizon rule: the horizon line (vanishing point) crosses his chest,
so the lower his feet are on the floor, the bigger he is. Same pixels every
time, so nothing can drift.
"""
import glob, math, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC, ROOT = sys.argv[1], sys.argv[2]
CLIPS = os.path.join(ROOT, "clips")
STILLS = os.path.join(ROOT, "stills")
os.makedirs(CLIPS, exist_ok=True)
os.makedirs(STILLS, exist_ok=True)

W, H, FPS = 960, 540, 30
FULL_W, FULL_H = 2576, 1438
F = W / FULL_W  # full-res -> clip scale


def find(key):
    hits = glob.glob(os.path.join(SRC, f"*{key}*"))
    if not hits:
        sys.exit(f"missing image containing '{key}' in {SRC}")
    return hits[0]


corridor_full = Image.open(find("lobby_lasers_off")).convert("RGB")
pod_full = Image.open(find("pod_")).convert("RGB")
react_full = Image.open(find("hero_reaction")).convert("RGB")
hero_full = Image.open(find("hero_back")).convert("RGB")

# ---------------------------------------------------------------- hero cutout
arr = np.asarray(hero_full).astype(int)
bg = arr[5:20, 5:20].reshape(-1, 3).mean(axis=0)
diff = np.abs(arr - bg).max(axis=2)
mask = (diff > 20).astype(np.uint8) * 255
mask_img = Image.fromarray(mask).filter(ImageFilter.MedianFilter(3)).filter(ImageFilter.GaussianBlur(0.7))
hero_rgba = hero_full.convert("RGBA")
hero_rgba.putalpha(mask_img)
bbox = hero_rgba.getchannel("A").point(lambda v: 255 if v > 40 else 0).getbbox()
hero_cut = hero_rgba.crop(bbox)
HERO_AR = hero_cut.width / hero_cut.height
hero_cut.save(os.path.join(STILLS, "hero_back_cutout.png"))

# ------------------------------------------------------------- scene geometry
VP_X, VP_Y = 1288, 712            # vanishing point / horizon (full-res px)
CHEST = 0.65                       # chest height as a fraction of hero height
FAR_FLOOR_Y = 820                  # where the far door meets the floor
EDGE = 1.5                         # floor edge slope: dx per dy, each side
GRID_Y = 880                       # floor line where the laser grid stands


def hero_height(feet_y):
    """Horizon rule: horizon crosses his chest => h = (feet_y - horizon) / CHEST."""
    return (feet_y - VP_Y) / CHEST


def floor_edges(y):
    return (1095 - EDGE * (y - FAR_FLOOR_Y), 1482 + EDGE * (y - FAR_FLOOR_Y))


def wall_height(y):
    return 264 * (y - VP_Y) / (FAR_FLOOR_Y - VP_Y)


def scaled(img, k):
    return img.resize((max(1, int(img.width * k)), max(1, int(img.height * k))), Image.LANCZOS)


# -------------------------------------------------------------------- drawing
def draw_lasers(base, t, strength=1.0, scale=1.0, blink=False):
    """Draw the red laser grid onto base (RGB, size = base.size)."""
    if strength <= 0.01:
        return base
    glow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    core = Image.new("RGBA", base.size, (0, 0, 0, 0))
    gd, cd = ImageDraw.Draw(glow), ImageDraw.Draw(core)
    xl, xr = floor_edges(GRID_Y)
    floor = GRID_Y
    wh = wall_height(GRID_Y)
    for k, frac in enumerate((0.14, 0.32, 0.5, 0.68, 0.86)):
        y = floor - wh * (frac + 0.045 * math.sin(2 * math.pi * (t * 0.45 + k * 0.23)))
        pts = [(xl * scale, y * scale), (xr * scale, y * scale)]
        gd.line(pts, fill=(200, 50, 43, int(110 * strength)), width=max(3, int(16 * scale)))
        cd.line(pts, fill=(235, 70, 58, int(255 * strength)), width=max(1, int(5 * scale)))
    for flip in (0, 1):
        a = (xl, floor) if not flip else (xr, floor)
        b = (xr, floor - wh) if not flip else (xl, floor - wh)
        on = 1.0 if not blink else (0.55 + 0.45 * math.sin(2 * math.pi * (t * 0.8 + flip * 0.5)))
        pts = [(a[0] * scale, a[1] * scale), (b[0] * scale, b[1] * scale)]
        gd.line(pts, fill=(200, 50, 43, int(90 * strength * on)), width=max(3, int(14 * scale)))
        cd.line(pts, fill=(235, 70, 58, int(230 * strength * on)), width=max(1, int(4 * scale)))
    glow = glow.filter(ImageFilter.GaussianBlur(max(1, 7 * scale)))
    out = base.convert("RGBA")
    out.alpha_composite(glow)
    out.alpha_composite(core)
    return out.convert("RGB")


def place_hero(base, cx, feet_y, height, scale=1.0, alpha=1.0, tilt=0.0, mirror=False):
    """Paste the hero with feet at (cx, feet_y); all args in full-res units, scale maps to base."""
    hp = max(2, int(height * scale))
    wp = max(2, int(hp * HERO_AR))
    sprite = hero_cut.resize((wp, hp), Image.LANCZOS)
    if mirror:
        sprite = sprite.transpose(Image.FLIP_LEFT_RIGHT)
    if tilt:
        sprite = sprite.rotate(tilt, resample=Image.BICUBIC, expand=True)
    if alpha < 1.0:
        a = sprite.getchannel("A").point(lambda v: int(v * alpha))
        sprite.putalpha(a)
    # contact shadow
    sh = Image.new("RGBA", base.size, (0, 0, 0, 0))
    sw, shh = int(wp * 0.62), max(3, int(hp * 0.035))
    sd = ImageDraw.Draw(sh)
    fx, fy = int(cx * scale), int(feet_y * scale)
    sd.ellipse([fx - sw // 2, fy - shh, fx + sw // 2, fy + shh], fill=(40, 38, 36, int(95 * alpha)))
    sh = sh.filter(ImageFilter.GaussianBlur(max(1, hp * 0.012)))
    out = base.convert("RGBA")
    out.alpha_composite(sh)
    x0 = int(fx - sprite.width / 2)
    y0 = int(fy - sprite.height)
    out.alpha_composite(sprite, (x0, y0)) if (x0 >= 0 and y0 >= 0) else out.paste(sprite, (x0, y0), sprite)
    return out.convert("RGB")


def folder_stack(base, cx, floor_y, scale, t=1.0, wobble=0.0):
    """Tall wobbly stack of manila folders with lanyard + tie on top, clipboard on the floor."""
    out = base.convert("RGBA")
    d = ImageDraw.Draw(out)
    n = 11
    fw, fh = 150 * scale * 1.6, 15 * scale * 1.6
    shown = int(n * min(1, t))
    for i in range(shown):
        off = math.sin(i * 1.7 + wobble) * 9 * scale * 1.6 * (i / n + 0.2)
        x0 = cx * scale - fw / 2 + off
        y0 = floor_y * scale - (i + 1) * fh * 1.15
        shade = 215 - (i % 3) * 12
        d.rectangle([x0, y0, x0 + fw, y0 + fh], fill=(shade, int(shade * 0.84), int(shade * 0.52)),
                    outline=(92, 58, 40), width=max(1, int(2 * scale)))
        d.rectangle([x0 + fw * 0.08, y0 - fh * 0.35, x0 + fw * 0.34, y0], fill=(shade - 10, int(shade * 0.8), int(shade * 0.48)),
                    outline=(92, 58, 40), width=max(1, int(2 * scale)))
    if t >= 1.0:
        top = floor_y * scale - n * fh * 1.15 - fh * 0.2
        tx = cx * scale
        d.polygon([(tx - 6 * scale * 1.6, top), (tx + 18 * scale * 1.6, top - 4 * scale * 1.6),
                   (tx + 12 * scale * 1.6, top + 22 * scale * 1.6), (tx - 4 * scale * 1.6, top + 18 * scale * 1.6)],
                  fill=(200, 50, 43), outline=(92, 40, 36))
        d.line([(tx - 30 * scale * 1.6, top + 12 * scale * 1.6), (tx - 6 * scale * 1.6, top + 6 * scale * 1.6)],
               fill=(70, 70, 74), width=max(1, int(3 * scale)))
        d.rectangle([tx - 38 * scale * 1.6, top + 10 * scale * 1.6, tx - 20 * scale * 1.6, top + 34 * scale * 1.6],
                    fill=(230, 230, 232), outline=(70, 70, 74), width=max(1, int(2 * scale)))
        cx2 = tx + 130 * scale * 1.6
        d.rectangle([cx2, floor_y * scale - 20 * scale * 1.6, cx2 + 70 * scale * 1.6, floor_y * scale + 4 * scale * 1.6],
                    fill=(124, 82, 56), outline=(60, 40, 30), width=max(1, int(2 * scale)))
    return out.convert("RGB")


def flash(base, amount, color=(255, 250, 240)):
    if amount <= 0:
        return base
    over = Image.new("RGB", base.size, color)
    return Image.blend(base, over, min(1.0, amount))


def ease(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


# ---------------------------------------------------------------- frame sources
corr = corridor_full.resize((W, H), Image.LANCZOS)
pod = pod_full.resize((W, H), Image.LANCZOS)
react = react_full.resize((W, H), Image.LANCZOS)

HINGE_FEET = 1000
INTRO_FEET = 1300
CX = VP_X + 4


def encode(name, frames):
    path = os.path.join(CLIPS, name)
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
           "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "24", "-preset", "medium",
           "-g", "15", "-movflags", "+faststart", "-an", path]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    n = 0
    for fr in frames:
        p.stdin.write(fr.convert("RGB").tobytes())
        n += 1
    p.stdin.close()
    p.wait()
    print(f"{name}: {n} frames, {n / FPS:.2f}s")


def seconds(s):
    return range(int(s * FPS))


def hinge_frame(t, lasers=1.0):
    fr = draw_lasers(corr.copy(), t, lasers, F, blink=True)
    return place_hero(fr, CX, HINGE_FEET, hero_height(HINGE_FEET), F)


# 1. respawn: pod with slow push-in
def respawn():
    dur = 2.4
    for i in seconds(dur):
        t = i / FPS
        z = 1.0 + 0.05 * (t / dur)
        w, h = int(W / z), int(H / z)
        x0, y0 = (W - w) // 2, (H - h) // 2
        fr = pod.crop((x0, y0, x0 + w, y0 + h)).resize((W, H), Image.LANCZOS)
        yield flash(fr, 0.8 * (1 - ease(t / 0.5)))


# 2. intro: he walks away from camera, stops; grid sweeps; ends on hinge frame (hold)
def intro():
    walk, total = 2.8, 4.6
    for i in seconds(total):
        t = i / FPS
        p = ease(t / walk)
        feet = INTRO_FEET + (HINGE_FEET - INTRO_FEET) * p
        bob = abs(math.sin(t * 7.5)) * 10 * (1 - p) * (1.0 if t < walk else 0)
        fr = draw_lasers(corr.copy(), t, 1.0, F, blink=True)
        fr = place_hero(fr, CX + math.sin(t * 3.7) * 4 * (t < walk), feet - bob, hero_height(feet), F)
        yield fr


# 3. success: grid clicks off, glow, he relaxes
def success():
    dur = 2.6
    for i in seconds(dur):
        t = i / FPS
        k = 1.0 - ease((t - 0.5) / 0.7)
        if t < 0.5:  # buzz before it clicks off
            k = 1.0 if int(t * 14) % 2 == 0 else 0.35
        fr = draw_lasers(corr.copy(), t + 4.0, k, F, blink=True)
        sag = 1.0 + 0.012 * ease((t - 1.2) / 0.6)
        fr = place_hero(fr, CX, HINGE_FEET, hero_height(HINGE_FEET) * sag, F)
        yield flash(fr, 0.35 * math.exp(-((t - 1.2) ** 2) / 0.05))


# 4. death (jump / lateral): hero lunges at the grid, flash, reaction cut-in, folder stack
def death(kind):
    dur = 3.4
    mirror = kind == "right"
    for i in seconds(dur):
        t = i / FPS
        if t < 1.0:  # lunge toward the beams
            p = ease(t / 0.9)
            feet = HINGE_FEET + (GRID_Y + 30 - HINGE_FEET) * p
            lift = 0
            dx = 0
            if kind == "jump":
                lift = math.sin(min(1, t / 0.9) * math.pi) * 150
            else:
                dx = (70 if mirror else -70) * p
            fr = draw_lasers(corr.copy(), t + 4.6, 1.0, F, blink=True)
            fr = place_hero(fr, CX + dx, feet - lift, hero_height(feet), F)
            yield fr
        elif t < 1.55:  # reaction cut-in (the face-overlay moment)
            fr = react.copy()
            shake = int(6 * math.sin(t * 90))
            fr = fr.transform(fr.size, Image.AFFINE, (1, 0, shake, 0, 1, 0))
            yield flash(fr, 0.25 if t < 1.1 else 0)
        elif t < 1.75:  # white-out
            fr = draw_lasers(corr.copy(), t, 1.0, F)
            yield flash(fr, ease((t - 1.55) / 0.1))
        else:  # folder stack drops in, lasers keep humming
            p = (t - 1.75) / 0.9
            fr = draw_lasers(corr.copy(), t + 4.6, 1.0, F, blink=True)
            fr = folder_stack(fr, CX, GRID_Y + 30, F, t=ease(p), wobble=t * 3)
            yield flash(fr, 0.6 * math.exp(-((t - 1.8) ** 2) / 0.03))


encode("respawn.mp4", respawn())
encode("lobby_intro.mp4", intro())
encode("lobby_success.mp4", success())
encode("lobby_death_jump.mp4", death("jump"))
encode("lobby_death_side.mp4", death("left"))

# ------------------------------------------------- full-res placement stills
# (use these as start / end frames or as references when prompting Gemini)
def full_still(name, feet, lasers):
    fr = corridor_full.copy()
    if lasers:
        fr = draw_lasers(fr, 0.0, 1.0, 1.0, blink=False)
    fr = place_hero(fr, CX, feet, hero_height(feet), 1.0)
    fr.save(os.path.join(STILLS, name), quality=95)
    print("still:", name)


full_still("hinge_halfway_lasers_off.png", HINGE_FEET, False)
full_still("hinge_halfway_lasers_on.png", HINGE_FEET, True)
full_still("intro_start_close_lasers_on.png", INTRO_FEET, True)

# face-forward reaction still + a crop of the face for the badge placeholder
react_full.save(os.path.join(STILLS, "hero_reaction.jpg"), quality=92)
badge = react_full.crop((1030, 150, 1560, 920)).resize((265, 385), Image.LANCZOS)
badge.save(os.path.join(ROOT, "default_badge.jpg"), quality=90)
print("done")

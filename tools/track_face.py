#!/usr/bin/env python3
"""
Tracks the hero's head through a clip and prints a faceOverlay "track" for
scenes.json, so the player's cartoon face follows him frame by frame.

  python3 tools/track_face.py clips/lobby_death_jump_binders.mp4 \
      --ref 60 --head 596,40,682,165 --frames 58-89 --face 5,30,74,124

--ref    a frame where his face is clearly toward the camera
--head   his head (hair included) in that frame: x0,y0,x1,y1 in pixels
--frames the frame range where the face is visible
--face   the face ellipse relative to the head centre: dx,dy,width,height

It matches the head template at a few scales in every frame, smooths the
path, and keeps every 2nd frame (the engine interpolates between them).
Check the output by eye: face detectors and swap models trained on real
photos miss cartoon faces, which is why this uses plain template matching.
Needs opencv-python-headless and numpy.
"""
import argparse, json
import cv2
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("clip")
ap.add_argument("--ref", type=int, required=True)
ap.add_argument("--head", required=True)
ap.add_argument("--frames", required=True)
ap.add_argument("--face", required=True)
ap.add_argument("--step", type=int, default=2)
a = ap.parse_args()

x0, y0, x1, y1 = map(int, a.head.split(","))
f0, f1 = map(int, a.frames.split("-"))
dx, dy, fw, fh = map(float, a.face.split(","))

cap = cv2.VideoCapture(a.clip)
fps = cap.get(cv2.CAP_PROP_FPS)
frames = []
while True:
    ok, f = cap.read()
    if not ok:
        break
    frames.append(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY))
H, W = frames[0].shape

tpl = frames[a.ref][y0:y1, x0:x1]
th, tw = tpl.shape
pad = 3 * max(th, tw)
sx0, sy0 = max(0, x0 - pad), max(0, y0 - pad)
sx1, sy1 = min(W, x1 + pad), min(H, y1 + pad)

path = {}
for i in range(f0, f1 + 1):
    best = None
    for s in np.linspace(0.85, 1.25, 17):
        t = cv2.resize(tpl, None, fx=s, fy=s)
        r = cv2.matchTemplate(frames[i][sy0:sy1, sx0:sx1], t, cv2.TM_CCOEFF_NORMED)
        _, score, _, (mx, my) = cv2.minMaxLoc(r)
        if best is None or score > best[0]:
            best = (score, sx0 + mx + tw * s / 2, sy0 + my + th * s / 2)
    path[i] = best
    if best[0] < 0.6:
        print(f"warning: weak match at frame {i} ({best[0]:.2f})")


def smooth(i, k):
    ks = [j for j in (i - 1, i, i + 1) if j in path]
    return sum(path[j][k] for j in ks) / len(ks)


track = []
for i in list(range(f0, f1 + 1, a.step)):
    track.append([round(i / fps, 3), round((smooth(i, 1) + dx) / W, 4), round((smooth(i, 2) + dy) / H, 4)])
print(json.dumps({"size": [round(fw / W, 4), round(fh / H, 4)], "fade": 0.1, "track": track}))

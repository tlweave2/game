# Prompt bible

Paste these blocks verbatim. Only the SHOT line changes between generations. Record the tool, model version, seed and date next to every keeper. When a block changes, save it as a new version (v3, v4) and note why.

## Workflow rules that keep the character stable

1. One shot per chat. Start a fresh chat for each image and attach only the canon files from `art/canon/`.
2. Always reference the canon image, never the previous generation.
3. Change one thing per generation. Placing, resizing and restyling in one prompt is where drift starts.
4. Reject, do not repair. If trousers, socks, tie or cowlick are wrong, regenerate.
5. For placement shots, composite instead of prompting: `tools/make_placeholders.py` cuts the hero out of `hero_back_v2` and places him with the horizon rule (same pixels, no drift).

## STYLE block (v1)

```
2D hand-drawn cartoon animation cel, 1980s American theatrical animation
style, bold clean dark-brown ink outlines of even thickness, flat cel shading
with a single shadow tone per color, soft painted backgrounds, slightly
exaggerated proportions. Limited palette: warm beige #D9C7A5, tan #B89968,
off-white #F2EBDD, muted gray #7D7F83, accent red #C8322B. No text,
no lettering, no logos, no watermark, no photorealism, no 3D render, no
gradients on the character.
```

## CHARACTER block (v2, "Noodle")

```
Character "Team Member": adult office worker, extremely tall and thin with a
tiny head on a long neck, spindly noodle-like arms and legs, huge oversized
shoes. Gray single-breasted suit far too big, sleeves hanging past the
fingertips, shoulders drooping off the frame of the body, trousers too short
and showing mismatched socks (one tan, one off-white). Short messy brown hair
with one stubborn cowlick sticking straight up. Thin red tie that is too long
and flips over one shoulder. Dark gray lanyard with a blank white ID badge
swinging at the hip. Brown clipboard held in front like a shield. Nervous,
hunched posture, knees slightly knocked together.
```

Known failure: when he is drawn small the model turns "trousers too short" into shorts. Add this clamp to any small or distant shot:

```
He is wearing full-length gray suit trousers that reach his ankles, the same
as the reference image, with the mismatched tan and off-white socks just
visible between the trouser hems and the shoes. No shorts, no bare knees.
```

Canon checklist for accepting an image: gray suit, red tie, lanyard with blank badge, clipboard, brown hair with cowlick, mismatched socks, oversized black shoes.

## ENVIRONMENT block, Lobby (v1)

```
Interior of a windowless beige office corridor in a villain's corporate lair.
Long straight hallway receding to a single closed gray door at the far end.
Flat beige walls with a tan baseboard, off-white drop-ceiling tiles with
fluorescent panels, a worn gray carpet, a row of recessed horizontal
strip-light slots in each wall, a small empty sign stand on the left side of
the floor. One-point perspective, camera at chest height, centered.
```

Do not use the words "soft glow where the beams were" for the lasers-off plate. It produced pink stains on the walls. Ask for "clean beige walls and gray floor, no red tint, no smudges".

## Shots

Hero front, canon (no reference):
```
SHOT: full body, front view, standing in a nervous neutral pose, centered,
entire figure visible from head to shoes, plain flat light-gray background.
```

Hero back (attach canon):
```
SHOT: the same character as the reference image, seen from directly behind,
full body, standing, centered, plain flat light-gray background. Show the
cowlick, the drooping shoulders, the sleeves hanging past the hands, the red
tie flipped over one shoulder, and the mismatched socks. Match the suit,
proportions, and colors of the reference exactly.
```

Hero reaction (attach canon). This is the face-overlay frame:
```
SHOT: the same character as the reference image, facing the camera, head and
shoulders close-up so the head fills a large part of the frame, eyes wide
open in shock, mouth open, eyebrows raised, clipboard raised toward the
camera, plain flat light-gray background. Match the reference exactly.
```

Lasers-on plate (attach the lasers-off plate):
```
SHOT: the same corridor as the reference image, identical walls, ceiling,
floor, sign stand, and far door. Add a grid of thin glowing accent-red laser
beams crossing the corridor about two-thirds of the way down the hall,
horizontal and diagonal, leaving the nearer half of the corridor empty. Walls
and floor stay clean beige and gray, no red tint, no smudges. No characters.
```

Folder-stack death still (attach the lasers-on plate):
```
SHOT: in the corridor from the reference image, in the same spot where a
person was standing, a tall wobbly stack of manila folders. A dark gray
lanyard with a blank white ID badge and a thin red tie are draped over the
top. A brown clipboard lies on the floor beside it. No person visible. The
red laser grid is still active behind the stack.
```

Pod: STYLE + "a glossy white sci-fi capsule built into a beige office wall, its door sliding open with a puff of steam, a faint accent-red status light, a small potted plant beside it for no reason. Empty, no characters."

Desmond on monitor: STYLE + "a chunky old security monitor screen showing a smooth villain in an expensive dark suit, slicked-back hair, thin tight smile, fingertips steepled, sitting in a dark office. Slight scan-line effect on the screen. Wall-mounted monitor in a beige corridor."

## Motion prompts (image-to-video, static camera)

Intro (start: hero walking in, end: hinge frame):
```
The tall thin character walks forward a few slow nervous steps and stops.
His long legs swing loosely, the sleeves flop, the red tie flaps, the
cowlick bounces, the lanyard swings. Red laser beams sweep slowly in the
background. Static camera, no cuts, no zoom.
```

Success (start: hinge frame, end: lasers off):
```
The red laser beams click off one by one and fade into a soft glow. The
character stays perfectly still, then relaxes his shoulders slightly. The
cowlick wobbles once. Static camera, no cuts, no zoom.
```

Death (start: hinge frame, end: folder stack):
```
The character panics and jumps, hits the red laser beams, and collapses
into a tall wobbly stack of manila folders. The lanyard and red tie flutter
down and land on top. Cartoon timing, quick snap. Static camera, no cuts,
no zoom.
```

Respawn (attach pod and hero front):
```
The pod door slides open with a puff of steam. The tall thin character
unfolds out of the small pod in awkward sections: one long leg, then an arm,
then his folded torso, then his head last, and finally straightens up to his
full height, clipboard in hand. Static camera, no cuts.
```

## Placement numbers (full-res 2576x1438 corridor)

Vanishing point (horizon): x 1288, y 712. Chest is about 65 percent of hero height, so hero height = (feet_y - 712) / 0.65. Hinge frame: feet at y 1000. Intro start: feet at y 1300. Laser grid stands at floor y 880.

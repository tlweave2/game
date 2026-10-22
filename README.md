# Orientation Day

A Dragon's Lair style comedy game. You are the new hire at Doomsworth & Associates. Every hallway is a workplace hazard, the narrator is a cheerful HR onboarding voice, and deaths are filed as safety violations. Compliance wins, heroics kill.

This repo is the vertical slice: one room (the Lobby), five placeholder clips, and the web player.

## Run it

The player loads `scenes.json` with `fetch`, so serve the folder over http:

```
python3 -m http.server 8000
```

Open http://localhost:8000/ and press Begin. Add `?debug=1` (or press the backtick key) for a scene jump list and a live timer readout.

Controls: A / D or arrow keys for left and right, W or Space for jump, S for stop, M to mute the theme music. Only the moves a prompt shows are live, and a prompt offers at most three. On a phone, tap the buttons.

In the Lobby the correct answer is to do nothing or press STOP. Jump and Left each file a different incident report.

## How it fits together

| File | Job |
|---|---|
| `index.html` | Markup and styles. |
| `engine.js` | Plays the scene graph: clip pool with preloading, instant swap between clips, timed prompts, captions, death cards, face overlay. |
| `scenes.json` | The whole game. Scenes, branches, timing, captions, death card text. |
| `clips/` | Video clips. Currently placeholders. |
| `tools/make_placeholders.py` | Builds placeholder clips and placement stills from `art/canon`. |
| `art/canon/` | The locked reference images. Never edit these. |
| `docs/prompt-bible.md` | The locked prompt blocks, shots and motion prompts. |
| `stills/` | Hero cutout and full-res placement stills (hinge frame, intro start frame). |

## Scene types

- `cutscene`: plays `clip`, then goes to `next`.
- `reflex`: plays `clip`. At `decisionAt` seconds a prompt opens for `window` seconds. `prompt` lists the choices shown (three at most). `inputs` maps each action to the next scene. `timeout` is where it goes if the player does nothing. The last frame holds while the prompt is open.
- `success`: plays `clip`, optionally stamps a `stamp` document into the player's file, then goes to `next`.
- `death`: plays `clip`, then shows an incident report built from `card`, then returns to the retry scene. `flip: true` mirrors the clip, so one left-lunge clip serves both directions. `faceOverlay` gives the time window and a rectangle (fractions of the frame) where the player's badge photo is drawn over the reaction shot.
- `end`: shows the personnel file and a closing line.

Captions are `{ "at": seconds, "who": "Cheryl", "text": "..." }`. Add `"onlyFirst": true` for a line that plays only on the first respawn, and `"audio": "file.mp3"` to play a recording from `audio/` (it falls back to browser speech if the file is missing and the placeholder voice is on). Recorded lines never overlap: one that comes up while another is playing waits its turn, and cutscene and success scenes hold their last frame until Cheryl finishes. The recordings and their script are listed by number in `audio/` (`cheryl_04` and `cheryl_05` are recorded for the security-scan Lobby and not used yet).

## Swapping in real clips

Keep the file names and the timing, replace the files in `clips/`:

- H.264 MP4, 30 fps, 960x540 or 1280x720, no audio track needed, keyframe every 15 frames, `-movflags +faststart`.
- `respawn.mp4` about 2.4 s. `lobby_intro.mp4` about 4.6 s, ends on the hinge frame and holds still for the last 1.5 s (that is where the prompt window sits). `lobby_success.mp4` and the two death clips start from the hinge frame so every cut is seamless.
- If a clip's length changes, update `decisionAt`, `window` and the caption `at` times in `scenes.json`.
- For the face overlay, the reaction shot must sit at the times and position given in `faceOverlay`.

Example encode:

```
ffmpeg -i raw.mp4 -vf scale=960:540 -r 30 -c:v libx264 -pix_fmt yuv420p -crf 23 -g 15 -movflags +faststart -an clips/lobby_intro.mp4
```

## Placeholder clips

```
python3 tools/make_placeholders.py art/canon .
```

Needs Python 3, Pillow, numpy and ffmpeg. It cuts the hero out of `art/canon/hero_back_v2.jpeg` and places him in the corridor using the horizon rule, so the character is always the same pixels.

## Known limits

- The face overlay draws on a fixed rectangle for a fixed time window. It does not track a moving head, so the reaction shot has to hold still.
- The browser blocks sound until the first click, which is why there is a start screen.
- Keep clips short and small. The player keeps only the current scene and its next branches in memory.
- The old Gemini reference images can be lost between chats. The canon copies live in `art/canon/`.

## Writing for the narrator

Cheryl never acknowledges that anyone is dying. Same cheerful cadence for every line, no matter the outcome. Keep her script in `scenes.json` and record from it. If a line changes after recording, record that line again.

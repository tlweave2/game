# Theme music: "Mandatory Fun"

The game ships with a synthesised theme in `music.js` (Web Audio, no files). It is an upbeat office hold-music bossa in F major at 112 BPM: electric piano on the off-beats, walking root-fifth bass, shaker and rim click, and a whistly lead hook that ends on one sour note. The melody sits out every other pass so the loop doesn't wear thin.

Behaviour in game:

- Starts on Begin, loops under every scene.
- Ducks while Cheryl speaks.
- On a death it cuts out with a descending "wah wah" and stays silent on the incident report. It comes back on Re-onboard.
- M mutes it. The "Theme music" checkbox on the title screen sets the same thing, and the choice is remembered.

## Replacing it with a recording

Drop a loopable file at `audio/theme.mp3`. The player checks for it on load and plays it instead of the synth, with the same ducking and mute. The death sting only plays with the synth.

Prompt for a music generator (Suno, Udio, etc.):

> Instrumental, 112 BPM, F major. Cheerful 1980s corporate training-video hold music, light bossa nova groove. Warm Rhodes electric piano comping on the off-beats, round walking bass, soft shaker and rim clicks, a bright whistled synth lead playing a short, very hummable 4-bar hook. Polished, upbeat, slightly too cheerful, with a faint sinister undertone, like a smiling HR manager. No vocals. Seamless loop, about 60 seconds, no intro or fade out.

Trim the result so it loops cleanly (start and end on the downbeat of bar 1) before committing it.

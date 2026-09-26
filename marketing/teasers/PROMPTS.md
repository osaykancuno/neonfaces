# Launch teasers for X

Five short videos, posted in order until the mint. No numbers, no dates, no prices. Built from the collection's own art: each video starts (and the 4th and 5th end) on a frame in this folder, made from `landing/img` with nearest-neighbour scaling so the pixels stay square.

- Model: Google Veo 3.1 Lite on Higgsfield, 8 s, 16:9, native audio (12 credits each; 100 in the trial account). The trial only generates through the Higgsfield MCP connector (`https://mcp.higgsfield.ai/mcp`), not the CLI.
- Voice: one calm, low, close-mic female voice, English, lines already used in the project's copy.
- Generate video 1 first and check it before spending on the rest.

Style block, appended to every prompt:

> Style: flat 2D pixel art that stays strictly pixelated (hard square cells, no smoothing, no 3D, no realistic skin), limited palette of black, olive greens and acid lime neon #CCFF00 (a yellow-green, never pure yellow or orange) with rare white highlights, subtle film grain and faint CRT scan lines, slow deliberate camera, dark and tense mood. No on-screen text, no subtitles, no numbers, no logos, no people other than the pixel faces. Audio: no music with lyrics.

(Video 5 drops "no logos" and "no on-screen text": its end frame is the NEONFACES card.)

## Results (26 Sep)

Generated: `1-signal.mp4` … `5-soon.mp4` (8 s, 1280x720, audio). Originals from the model are in `raw/` (git-ignored). What was checked and fixed:
- Video 1 came out warmer than the palette (pure yellow), so the style block now names the lime explicitly; videos 2-5 also say when the voice speaks ("the first N seconds have no voice").
- Video 2: the first take cut to a wall of faces that are not in the collection. Regenerated with the wall as both start and end frame and "no new faces appear".
- Video 4: in the last second the face closed its eyes (against "they don't blink"). The final file holds the last open-eyed frame from 7.2 s to the end (ffmpeg, audio untouched).
- Video 5: the model added a second "THEY DON'T BLINK." line on the card. From 3.5 s the final file shows the real card (`5-soon-end.png`) with a short fade in, over the original audio.

## X cuts

Post the `x-*.mp4` files. The Higgsfield virality proxy (predictive, not a promise) scored `1-signal.mp4` overall 51, hook 39, sustain 85, with attention dipping between 2 and 5 s: the clip held people but opened on a near-black frame, and X autoplays muted. `python marketing/teasers/make_x_cuts.py` keeps length and audio and adds a 0.4 s cold open on the clip's strongest frame, a brighter first 2 s, and the voice line in the collection's pixel font while it is spoken. Re-measured on `x-1-signal.mp4`: the same scores (51 / 39 / 85, first-second peak 0.540 to 0.547), so the proxy does not reward these edits; they stay for muted autoplay, which the proxy (scored with sound) cannot see. Moving its hook score would take a new take with motion and voice in the first 3 s.

## 1. Signal
Start frame: `1-signal-hook-start.png` (the collection's set face, lit, so the clip opens on motion; the first take started from the dark `1-signal-start.png`)

> From the very first frame there is movement: the bright pixel-art face glitches hard, its pixel rows jolting sideways and snapping back, while the camera makes a fast, punchy push-in toward the eyes. In the first second a calm, low, close-mic female voice says: "They don't blink." The eyes flare acid lime neon and lock onto the viewer, wide open, never closing. Then the neon flickers off and on twice like a failing sign, each flicker revealing the same face staring even harder, and the camera settles in an extreme close-up on the unblinking eyes. At the end the voice whispers again: "Look closer." Sound: a sharp electric zap and bass hit on the first frame, the buzz and click of neon tubes, a deep sub-bass pulse, silence on the last word.

The model turned the face into a smoother, near-photographic one; the user preferred it. Virality proxy: 50 (hook 37, sustain 87) against 51 (39, 85) for the first take: the proxy does not separate them. Scores of the others: video 2 51 (hook 38, sustain 91), video 3 48 (hook 35, sustain 92).

## 2. Watching
Start frame and end frame: `2-watching-start.png`

> The same wall of pixel-art face close-ups from the first frame stays on screen the whole time: no new faces appear, no cut, no zoom out, the tiles never change. Very slow lateral drift of the camera across this wall. One by one, the eyes in the tiles catch a faint acid lime neon glint, as if they were all turning to look at the viewer, then the glow fades back to the first frame. The first three seconds have no voice. Then a calm, low, close-mic female voice says: "Someone has to keep watching." Sound: a low electrical hum, soft data crackle, a rising tone that swells as the eyes glint and cuts to silence.

## 3. Never closes
Start frame: `3-eyes-start.png`

> An extreme close-up of a single pixel-art eye in acid neon yellow. It never blinks. Inside the dark iris, abstract glowing bars rise and fall like a market chart, with no digits or letters, reflected in the pixels. The glow pulses slowly and grows brighter. A calm, low, close-mic female voice says: "The market never closes." Sound: a clock ticking that slows and melts into a deep bass pulse, faint electronic shimmer.

## 4. The Gaze
Start frame: `4-gaze-start.png` · End frame: `4-gaze-end.png`

> Four pixel-art fragments of one face float apart on black: two eyes above, two halves of a mouth below. A neon glow gathers around them, then they slide together slowly and lock into one whole face with a soft magnetic snap, and the face's glow blooms from faint to burning bright. The eyes stare at the viewer, unblinking. A calm, low, close-mic female voice says: "The stare can work." Sound: a swelling analog synth, a rising riser, a deep click when the pieces lock.

## 5. Soon
Start frame: `5-soon-start.png` · End frame: `5-soon-end.png`

> A dark wall of dim pixel-art faces. The screen flickers like a failing neon sign; for an instant every face opens its eyes at once in bright acid yellow, then everything cuts to black, and the neon card with the pixel eye and the word NEONFACES powers on. A calm, low, close-mic female voice says: "They don't blink. Neither do I." Sound: a long riser, a hard hit on the flicker, then silence and the buzz of the neon card.

# What's inside a Face: the name reveal video and post

`neonfaces-inside.mp4`: 18 s, 1280x720, audio, captions in the collection's pixel font. It reveals the name and says what a Face is: an artwork with a wallet and a small piece of the market inside. No site, no date, no price (27 Sep: the site stays out until the sale is announced).

Rebuild (repo root, ffmpeg on PATH):
```bash
python marketing/inside/make_frames.py                           # start/end frames for the generator
python marketing/inside/pixelate.py raw/b-human.mp4 b-human.mp4   # clip B in the art's six tones
python marketing/inside/make_cut.py                              # the cut (--no-name: THEY DON'T BLINK. card)
```

## The two generated clips (27 Sep)

Seedance 2.0 Mini on Higgsfield (MCP), 4 s, 720p, 16:9, native audio with no voice (the voice comes from the teasers, so it stays the same voice): 4 credits each, 8 of the 9.4 left. Veo 3.1 Lite (6 credits for 4 s) would not have fitted twice. The preset "IN THE DARK" was proposed again and declined (`declined_preset_id` 24bae836-2c4a-48e0-89b6-49fcc0b21612). Originals in `raw/`.

Hook rules applied from `marketing/teasers/PROMPTS.md`: motion and a hit on the first frame, a bright start frame (the brightest face of the site, not a dark one), no voice in the clip, captions added in the edit for muted autoplay.

**A, inside** (`a-inside-start.png` → `a-inside-end.png`, the end frame drawn by `make_frames.py`: rising bars for the stocks, a plain coin, a gold and a silver bar, no text, no logos):

> From the very first frame there is movement: the bright pixel-art face jolts with a hard glitch, its pixel rows snapping sideways and back, and the camera makes a fast, punchy push-in straight into one wide-open acid lime eye. The eye fills the screen, its dark pupil opens like a round doorway and the camera flies through it into the dark chamber inside the eye, where a few small glowing pixel objects float and slowly pulse: rising chart bars, a plain round coin, a gold bar and a silver bar, exactly as in the last frame. The eye never blinks. Style: flat 2D pixel art that stays strictly pixelated (hard square cells, no smoothing, no 3D, no realistic skin), limited palette of black, olive greens and acid lime neon #CCFF00 (a yellow-green, never pure yellow or orange) with rare pale highlights, subtle film grain and faint CRT scan lines, dark and tense mood, bright from the first second. No on-screen text, no subtitles, no numbers, no letters, no logos, no symbols on the coin, no people other than the pixel face. Audio: no voice, no speech, no narration, no music with lyrics. Sound: a sharp electric zap and a bass hit on the very first frame, a fast whoosh through the pupil, then a warm low hum and soft metallic chimes as the objects glow.

Result: the eyes snap open at 0.4 s (a good hook), the push-in and the chamber came out as asked; one orange cell at the eye's corner for half a second (the cut snaps every colour to the art's palette), the last 1.6 s are nearly still (the cut keeps 3.5 s).

**B, human** (`b-human-start.png`, the trailer's opening face, set #124):

> From the very first frame there is movement: the pixel-art face glitches once with a sharp flicker, then comes alive as a real human being: real skin texture, a slow breath, a slight turn of the head toward the camera, the lips parting a little, a faint knowing half smile. The person is still seen through large hard square pixel cells, like a real face on a giant neon pixel screen, in black, olive greens and acid lime neon #CCFF00. The eyes open a little wider and lock onto the viewer, never blinking, not once. Slow push-in toward the eyes; in the dark of the pupils tiny glowing pixel chart bars and a small round coin are reflected. Style: the whole image stays pixelated (visible hard square cells over the real face, never a smooth HD photo), limited palette of black, olive greens and acid lime neon #CCFF00 (a yellow-green, never pure yellow or orange) with rare pale highlights, subtle film grain and faint CRT scan lines, intimate, human and tense, bright from the first second. Only this one face, nothing in front of it: no microphone, no hands, no objects, no other people. No on-screen text, no subtitles, no numbers, no letters, no logos. Audio: no voice, no speech, no narration, no music with lyrics. Sound: a sharp electric flicker and a deep bass hit on the very first frame, then a soft close breath, a slow heartbeat-like sub pulse and the quiet buzz of neon.

Result: the model ignored "stays pixelated" and made a smooth, natural-colour person (eyes closed, then open at 1.5 s, a smile, lime chart glints in the pupils in the last second, no blink after the eyes open). `pixelate.py` brings it back to the art (12 px cells on the start frame's grid, the six tones); the user asked (27 Sep) that the video end on the real face, so the cut resolves the cells into it in the last 1.5 s and holds it.

Like every face in the collection, the person in clip B does not exist: it was generated.

## Virality proxy (Higgsfield Virality Predictor, free, max 16 s; predictive, not a promise)

| Version | Overall | Hook | Sustain | First second |
|---|---|---|---|---|
| 16 s, A · faces · B · pieces · card, "Look closer." at 0.45 s | 50 | 35 | 99.6% | 0.457 |
| same, "Look closer." on the first frame | 52 | 36 | 99.6% | 0.480 |
| teasers of 26 Sep, for reference | 48-51 | 35-39 | 85-92% | 0.540 (teaser 1) |

The voice on the first frame helped a little and is kept. Attention peaks where the voice speaks. The final 18 s order (card before the human ending) is over the tool's 16 s limit and was not scored.

## The post (X, English; nothing public names the list's collections)

Post from the account with the video attached, on a weekday at 14:00 UTC (16:00 Italy, US markets open: the theme is the market). Pin it. No link for now: the name and the idea first, the site and the sale with the sale announcement.

**1/3 (with neonfaces-inside.mp4)**
> They don't blink.
>
> NEONFACES: 5555 faces, fully on-chain, on Robinhood Chain.
>
> Every Face is a wallet, with a small piece of the market inside.

**2/3 (reply)**
> What that means:
>
> · the art lives on the chain, pixel by pixel. No image server.
> · every Face has its own wallet (ERC-6551) and gets a small basket of Stock Tokens when it's minted.
> · keep it, add to it, withdraw what's inside, or sell it with everything in it.
>
> Stock Tokens give economic exposure only and are not available to US persons.

**3/3 (reply)**
> Some Faces stare harder than others. Some are one of four pieces that make one face. The longer a Face stays with its holder, the stronger its Gaze.
>
> No roadmap of promises. Just faces that don't blink.
>
> More soon.

Short version (a single post): "They don't blink. NEONFACES: 5555 fully on-chain faces on Robinhood Chain. Every Face is a wallet with a small piece of the market inside. More soon."

Why it is built this way: the first line is the video's line and the brand's, so the post and the clip say the same thing in the first second; the name comes in the second line, alone and in capitals; each reply adds one idea a newcomer needs (on-chain art, a wallet with a basket, what the holder can do) and nothing that sounds like a price or a return; the last line leaves the next step (the list, the site, the date) for the sale announcement.

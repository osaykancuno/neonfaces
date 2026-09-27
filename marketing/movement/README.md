# The movement: people who don't blink

Pre-sale content after the name reveal: 5 videos of 21-26 s (9:16 + 4:5), 5 images (4:5 + 9:16), 5 GIFs. Theme: real people, 25 to 45, who keep an eye on the market, their faces lit acid lime by a phone that shows their own Face. The viewer should feel part of it: everyone has a screen, some screens stare back.

Rules (as for every public piece): name yes, **no site, no date, no price** until the sale announcement; no em dashes; nothing that suggests destroying Faces; no returns or hype; never name the list's collections; the Stock Token line (docs/LORE.md) whenever a basket is named in a post.

## Real first (the user's rule, 27 Sep)

The first batch showed phones with the screen turned to the camera: nobody holds a phone like that, and it looked fake. Everything is now shot the way it happens:

| Kind | What the camera sees | Made with |
|---|---|---|
| **front** | the person looking at the phone; the screen faces them, the camera sees the phone's back and the lime light on the face; in the clip they look up into the lens | still (`gen_frames.py`, medium 1k) then a clip (`gen_clips.py`, Seedance 2.0 Mini) |
| **ots** | over the shoulder: the screen as the person sees it, with their own Face on it | still generated with a flat lime screen (a green screen), the exact on-chain Face put in by `make_frames.py` in perspective (fingers stay in front, the screen keeps its glare, a faint glow) |
| **turn** | their real face falls into cells, the colours drop into the art's six tones, the cells become their Face | local (`make_cut.py`): this is how the collection was made, portraits of people who don't exist through the pixel pipeline |
| **art** | a wall of Faces, the eye and the chart in the pupil, the basket inside, four pieces locking, the Gaze levels, the name card | local, from the collection's own images |

The same film grain runs over every frame and the art gets a screen's soft bloom, so the real and the pixel shots read as one world.

## The cast: people of the collection

Every person on screen is the source portrait of a real set (art/portraits, people who don't exist), so the Face on their phone is their own Face, the exact on-chain art. Set #337 (already public on the site) gives the four pieces of V4.

| Set | Who | In |
|---|---|---|
| #54 | woman, 35, bob | V1, V3, I1 |
| #286 | man, 32, bleached curls | V1, V3, I3 |
| #419 | woman, 31 | V1, V4 |
| #51 | man, 28 | V2, V4, I2 |
| #385 | man, 32 | V2, V4 |
| #198 | woman, 30 | V2, V4, V5, I5 |

## Rebuild (repo root; the Higgsfield CLI signed in; ffmpeg on PATH)

```bash
python marketing/movement/make_refs.py     # refs/ (portraits and Faces; git-ignored)
python marketing/movement/gen_frames.py    # raw/<id>.png, frames/<id>.png for the ots shots (paid)
python marketing/movement/gen_clips.py     # raw/<id>.mp4 (paid)
python marketing/movement/make_cut.py      # out/v1..v5.mp4 + -4x5.mp4
python marketing/movement/make_extras.py   # out/i1..i5-4x5.png, -9x16.png, out/g1..g5.gif
```

Prompts: `frames.json` (stills) and `clips.json` (motion and sound). The starter plan runs 2 jobs at once, so the scripts send two at a time. raw/, frames/ and out/ stay off git (sizes); the scripts rebuild out/ from raw/.

## What was spent (27 Sep, Higgsfield account of the user, starter plan)

| Item | Count | Credits |
|---|---|---|
| First batch, screens facing the camera (rejected, in raw/rejected/) | 16 | 8 |
| Green screen test | 1 | 0.5 |
| Front stills (gpt_image_2_5 medium 1k) | 15 | 7.5 |
| Heroes over the shoulder (high 2k) | 4 | 11 |
| Piece stills over the shoulder (medium) | 4 | 2 |
| Clips (seedance_2_0_mini 720p, 11 x 5 s + 4 x 4 s) | 15 | 71 |
| **Total** | | **100** (280 → 180 left) |

## The five videos (9:16 1080x1920; 4:5 = the middle 1080x1350)

Sound: each real shot keeps its own generated sound (no voice); the over-the-shoulder stills carry the same place's sound, softer; the voice lines come from the teasers (same voice as everything so far): "Look closer." (teaser 1), "Someone has to keep watching." (teaser 2), "The market never closes." (teaser 3), "They don't blink. Neither do I." (teaser 5, landing on the card). A bass hit (teaser 1) opens each turn. Loudness about -16 LUFS.

**V1 They don't blink** (23.2 s): #54 on the night tram looks up into the lens, "EVERYONE HAS A SCREEN." · over her shoulder, her Face on her phone, "SOME SCREENS STARE BACK." · #286 in the rain at a crossing looks up · #419 at her window looks up · her face turns into her Face, "5555 FACES. EACH ONE SOMEONE." · her Face shrinks into a wall of 16 lighting up, "FULLY ON-CHAIN." · card, "THEY DON'T BLINK."

**V2 The market never closes** (23.8 s): #51 in his kitchen before dawn, "5:50 AM." · over his shoulder, "STILL WATCHING." · #198 on a metro platform, a train strobing past · #385 in a taxi at 2 am looks up, "THE MARKET NEVER CLOSES." (the voice says it) · his face turns into his Face, "NEITHER DO THEY." · into the Face's eye, bars rising in the pupil, "THE CHART LIVES IN THE EYE." · card, "THE MARKET NEVER CLOSES. NEITHER DO THEY."

**V3 Every Face is a wallet** (21.1 s): #286 on his sofa taps his phone and smiles, "LOOK CLOSER." (the voice says it) · over his shoulder the camera goes into his screen, "EVERY FACE IS A WALLET." · inside: chart bars, a plain coin, a gold and a silver bar, "A SMALL PIECE OF THE MARKET INSIDE." · #54 slips her phone in her pocket and walks on, "IT GOES WHERE YOU GO." · card, "EVERY FACE IS A WALLET."

**V4 One face, four pieces** (23.3 s): four times, over the shoulder (each phone shows one piece of set #337) then the person looking up: #419 in a laundromat, #51 on a night bus ("SOME FACES ARE ONE OF FOUR."), #385 on a rooftop, #198 in a parked car ("FOUR HOLDERS.") · the pieces slide in and lock, "ONE FACE." · card with the whole face, "ONE FACE. FOUR PIECES."

**V5 The Gaze** (25.4 s): #198 on a bench on a grey morning, the glow faint, "DAY 30." · at an office window at dusk, stronger, "DAY 90." · over her shoulder at night, "DAY 365." · she looks up into the lens · her face turns into her Face · STEADY, FIXED, PIERCING (the renderer's bloom per level) · card, "THE LONGER IT STAYS, THE HARDER IT STARES."

## The story (out/story.mp4 + story-4x5.mp4, 60 s): `python marketing/movement/make_story.py`

Every piece of the movement in one arc, and the only piece with the site: the card says NEONFACES, NEONFACES.XYZ, COMING SOON (no date, no price; the user, 27 Sep). Two new clips and a music bed were generated for it (about 15 credits): `s-eye` (a macro eye with the lime of a screen in its pupil, the hook: it opens wide and never blinks), `s-windows` (a building's facade, window after window lighting up lime, the camera pulling back), and a 60 s instrumental score (Sonilo Music) under the whole cut.

0-3.5 the eye, "They don't blink." (voice and bass hit on the first second) · 3.5-17 the world: tram, rain, 5:50 AM, 11 PM on the metro, 2 AM in a taxi ("The market never closes." spoken), a rooftop, "NEITHER DO THEY." · 17-28.5 some screens stare back: her Face on her phone over her shoulder, she looks up, her face becomes her Face, "5555 FACES. EACH ONE SOMEONE." · 28.5-38.5 "Look closer." (spoken): into his screen, "EVERY FACE IS A WALLET.", the basket inside · 38.5-53.4 the wall of Faces "FULLY ON-CHAIN.", four people with four pieces, the pieces lock, "THE LONGER IT STAYS," Steady, Fixed, Piercing · 53.4-60 the lit building, "Someone has to keep watching." (spoken), the card with the site, "They don't blink. Neither do I." (spoken).

## Images (out/i*-4x5.png for feeds, -9x16.png for stories)

| # | Shot | Line |
|---|---|---|
| I1 | #54 on the tram, over the shoulder | They don't blink. |
| I2 | #51 in the kitchen before dawn | The market never closes. |
| I3 | #286 on the sofa | Every Face is a wallet. |
| I4 | the four people with the four pieces, 2 x 2 | One face. Four pieces. |
| I5 | #198 at night | The longer it stays, the harder it stares. |

## GIFs (out/g*.gif, 480 px, loops)

| # | Loop |
|---|---|
| G1 | #54 lifts her eyes to the lens and back, "CAUGHT YOU LOOKING." |
| G2 | #286's screen is dark, then his Face flickers in, "SWITCH ON. STARE BACK." |
| G3 | bars rising in the pupil, "THE CHART LIVES IN THE EYE." |
| G4 | four pieces lock, "CLICK." |
| G5 | Steady, Fixed, Piercing |

## Posts (X, English; no link)

**V1** They don't blink.
Everyone has a screen. Some screens stare back.
NEONFACES. 5555 faces, fully on-chain.

**V2** The market never closes. Neither do they.
NEONFACES: faces that keep watching.

**V3** Every Face is a wallet.
Pixel art on the chain, with its own account and a small basket of Stock Tokens inside.
Stock Tokens give economic exposure only, not legal ownership of shares; availability depends on where you live and on the issuer's terms.

**V4** One face. Four pieces.
Some Faces are one of four that make one face. Each is a Face of its own.

**V5** The longer a Face stays with its holder, the harder it stares.
Steady. Fixed. Piercing.

**I1** They don't blink.
**I2** 5:50 am. Still watching.
**I3** Look closer. There's a wallet in there.
**I4** Four holders. One face.
**I5** Patience shows. In the eyes.

**G1** Caught you looking.
**G2** Switch on. Stare back.
**G3** The chart lives in the eye.
**G4** Click.
**G5** Steady → Fixed → Piercing.

Suggested order until the sale announcement (Sun 4 Oct), videos at 16:00 Italy (US markets open), images and GIFs as replies or in the morning: Mon V1 + G1 · Tue I2 + V2 · Wed V3 + G2 · Thu I4 + V4 · Fri V5 + G5 · Sat I1, I3, I5, G3, G4 spread out. After the announcement the same pieces can carry the site.

Every person in these pieces was generated: like every face in the collection, they don't exist.

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

## Second batch (28 Sep): two posts a day until the sale

The founder posts twice a day, at 10:00 and 16:00 Italy, from Tue 29 Sep to the sale (Wed 7 Oct). New people and new
places (no scene repeats a scene of the first batch), and an instrumental score under every piece this time, below
the clips' own sound. Budget set by the founder: 65 credits, then 25 more "to do it at best"; spent **87.96** (18
stills 9, 15 clips 60, 17 tracks 18.96). After the founder's first listen: the voice lines from the teasers always
whole ("They don't blink." 0-1.9 s and "Look closer." 6.0-7.5 s in teaser 1, "They don't blink. Neither do I." from
3.3 s in teaser 5), never two voices at once, no teaser zap opening every piece, no teaser ticking; V3 got its own
melodic track (the score's opening pulses read as a repeating digital sound); wall, chain, announce and cam were
generated again as melodies (the first takes, all drums and glitches, are kept as raw/music-*-percussive.m4a); two-line
captions are balanced. N1 stays as first cut (the founder liked its sound). Second listen: V3's soft melodic track
was not liked, so it has a dark driving one in N1's style (the soft take kept as raw/music-v3-soft.m4a); the art
segments drift in a slow sub-pixel push-in (the cells alone moved in steps and read as a stutter); the music is no
longer a fixed bed (`score()` in make_cut.py): it comes in after the scene's own sound, joins its track mid-way as if
it had started before, ends with the track's own ending on the card, and dips under every voice line.

| Set | Who | Where |
|---|---|---|
| #336 | man, 26 | a station concourse at rush hour, the crowd rushing past (N1, also over the shoulder) |
| #57 | woman, 34 | a long metro escalator going down (N1) |
| #5 | man, 45 | a footbridge over a highway at dusk (N1) |
| #378 | woman, 44 | a stalled elevator in a blackout (N2, also over the shoulder) |
| #211 | woman, 27 | an underground garage, the last light dying (N2) |
| #490 | man, 42 | a black stairwell in a blackout (N2) |
| #182 | woman, 26 | a bus stop in heavy snow (N3, also over the shoulder) |
| #60 | man, 55 | an iron bridge in fog (N3) |
| #226 | woman, 45 | a window in a thunderstorm (N3) |
| #539 | man, 27 | a selfie in a dark bedroom, the phone's neon light on his face (NEONCAM) |
| #257 | woman, 52 | a balcony before sunrise, coffee in hand (Today) |
| #56 | woman, 33 | a rooftop terrace at night, wind in her hair (Announce) |
| #130 | woman, 34 | a late-night cafe in the rain, a small surprised smile (List) |
| #471 | man, 35 | a kitchen table at night (How to mint) |
| #58 | man, 54 | awake in bed, the night before (Tomorrow) |

Rebuild: `make_refs.py`, then `gen_frames.py` / `gen_clips.py` / `gen_music.py` with the ids above (prompts in
frames.json, clips.json, music.json), then `make_cut.py n1 n2 n3 v3 v4 v5` and `make_launch.py`. Beds: V3, V4 and V5
take three sections of the story's score (one sound for the series); every new piece has its own track. Masters at
-14 LUFS (V1 and V2 were -16).

| Piece | File | s | What |
|---|---|---|---|
| N1 Everyone moves | out/n1.mp4 | 18.8 | stillness in the rush: concourse, escalator, footbridge; his Face on his phone; the turn; card |
| N2 Lights out | out/n2.mp4 | 18.6 | a blackout: elevator, garage, stairwell; her Face in the dark; the turn; card |
| N3 Snow. Fog. Storm. | out/n3.mp4 | 18.6 | three kinds of weather, nobody blinks; the turn; card |
| Wall | out/l-wall.mp4 | 12 | 5555 faces flash by with a counter to 5555, then the eye: "one of them is looking at you" |
| Tiers | out/l-tiers.mp4 | 15.6 | Glance 4444, Watch 833, Heavy Stare 278 as walls of their own art; "the art decides, the reveal shows it" |
| Chain | out/l-chain.mp4 | 15 | a real on-chain record: its bytes scroll, then the Face is drawn from them, row by row |
| Announce | out/l-announce.mp4 | 20 | a woman on a rooftop looks up: NEONFACES has a date; then Thursday 1 October, 18:00 UTC, OpenSea, the list first, then everyone from Friday, the site |
| Public | out/l-public.mp4 | 12.6 | nine other people look up together: open to everyone, 0.018 ETH, up to 5 |
| List | out/l-list.mp4 | 14.2 | she finds out and smiles; the list's own clip; how the check works |
| Cam | out/l-cam.mp4 | 13 | a selfie lit neon, his face into NEONCAM's five tones, the photo, the site |
| Facts | out/l-facts.mp4 | 17.8 | check it yourself: five facts fixed on the chain |
| How to mint | out/l-howto.mp4 | 20 | a man at his kitchen table at night, then five steps, plain |
| Tomorrow | out/l-tomorrow.mp4 | 10.2 | awake in bed the night before; 14:00 UTC, the list goes first |
| Today | out/l-today.mp4 | 13 | sunrise, the turn, the facts |
| Open | out/l-open.mp4 | 12.6 | nine people of the batch look up together; the list is open |

### Calendar (videos only, 10:00 and 16:00 Italy, plus the two openings at 20:00)

The sale moved forward on 28 Sep (the founder): the list opens **Thu 1 Oct, 18:00 UTC (20:00 Italy)** for 24 hours,
then everyone from **Fri 2 Oct, 18:00 UTC**. The announcement goes out only once the contracts are deployed and verified.

| Day | 10:00 | 16:00 | 20:00 |
|---|---|---|---|
| Tue 29 Sep | N1 | **Cam** (the site revealed with NEONCAM: out/l-cam.mp4, post "Cam, launch") | **Announce** (neutral: out/l-announce-neutral.mp4, post "Announce, neutral") |
| Wed 30 Sep | List | How to mint | (optional) Tomorrow |
| Thu 1 Oct | Today | Wall | **Open** (the list opens) |
| Fri 2 Oct | N2 | V3 | **Public** (open to everyone) |
| Sat 3 Oct | N3 | V4 | |
| Sun 4 Oct | V5 | Tiers | |
| Mon 5 Oct | Chain | Facts | |
| Tue 6 Oct | | the story, live cut (out/story-live.mp4: the card says ON OPENSEA; `make_story.py live`) | |

Until the sell-out; after it, the reveal needs its own pieces. N1 to N3, V3 to V5, wall, tiers, chain, facts and cam
carry no date and work any day. Reaction GIFs (g6 to g12) go as replies under the day's post, never as a slot.

| GIF | Line | What |
|---|---|---|
| g6 | WHEN YOUR WALLET IS ON THE LIST. | she smiles, then her face falls into cells and becomes her Face |
| g7 | THE NIGHT BEFORE THE MINT. | awake in bed, then his Face |
| g8 | EVERYONE RUSHES. YOU DON'T. | the still man in the crowd, then his Face |
| g9 | MY NEW PFP. | the neon selfie, then NEONCAM's photo |
| g10 | HOW THEY SEE YOU. | a real face into its Face |
| g11 | THEY DON'T BLINK. | a wall of Faces lighting up |
| g12 | 5555 FACES. | the count, faces flashing by |

4:5, 480 x 600, loops, 4.7 to 6.3 MB. `python marketing/movement/make_extras.py gifs2`.

### Posts for the second batch (X, English)

**N1** Everyone moves. Some don't.
NEONFACES. 5555 faces that keep watching.

**Announce** NEONFACES opens on OpenSea: Thursday 1 October, 18:00 UTC.
The list goes first: 24 hours, 0.013 ETH, up to 3 Faces per wallet. Check your wallet on neonfaces.xyz
Then everyone, from Friday 2 October, 18:00 UTC: 0.018 ETH, up to 5 per wallet in total, until every Face is sold.
Every Face is a wallet with a small basket of Stock Tokens inside. Stock Tokens give economic exposure only, not legal ownership of shares; availability depends on where you live and on the issuer's terms.

**List** Is your wallet on the list?
Paste your address on neonfaces.xyz: the check runs in your browser, and your address is never sent anywhere.
The list mints first: 24 hours from Thursday 1 October, 18:00 UTC, up to 3 Faces each.

**How to mint** How to mint a Face, in five steps:
1. Check your wallet on neonfaces.xyz
2. Put ETH on Robinhood Chain, in the wallet you mint with
3. Thursday 1 October, 18:00 UTC: open the drop on OpenSea
4. The list mints first: 24 hours, up to 3 each
5. Your Face arrives with its own wallet
The public sale follows on Friday 2 October, 18:00 UTC.

**Tomorrow** Tomorrow, 18:00 UTC. The list goes first.
neonfaces.xyz

**Today** Today, 18:00 UTC, on OpenSea. The list goes first, for 24 hours.
(the drop's OpenSea link)

**Cam** See yourself the way they see you.
NEONCAM turns your camera into a Face: five tones, from black to neon. Nothing is uploaded.
neonfaces.xyz, Cam

**Open** The list is open.
24 hours for wallets on the list, up to 3 Faces each. Then everyone, from tomorrow at 18:00 UTC.
(the drop's OpenSea link)

**N2** Lights out. Eyes open.
When the city goes dark, the stare stays on.

**V3** as in "Posts" above (with the Stock Token line).

**Public** Now, everyone.
The sale is open to all: 0.018 ETH, up to 5 Faces per wallet, until the last one is sold.
(the drop's OpenSea link)

**N3** Snow. Fog. Storm.
Nothing makes them blink.

**V4, V5** as in "Posts" above.

**Tiers** Glance. Watch. Heavy Stare.
4444, 833 and 278 among the 5555 artworks. The art decides the tier; the reveal shows it, for everyone at once.

**Wall** 5555 faces. One of them is looking at you.
Every one drawn by the chain itself.

**Chain** 190 bytes.
Every Face is stored on Robinhood Chain, and the contract draws it every time someone asks. No server, no link that can break.

**Facts** Check it yourself.
5555 Faces, fixed in the contract. 111 for the team, capped. No proxy: the contracts can't be swapped. No pause: transfers can never be stopped. The art sealed against a fingerprint published before the mint.

**Story** Someone has to keep watching.
NEONFACES. neonfaces.xyz

**Safety** (a reply under the Announce, pinned until the sell-out; launch days are when fake mint links and fake support DMs appear):
The only official links: neonfaces.xyz and opensea.io/collection/neonfaces. The contract on Robinhood Chain is 0x67384d956ac12f2C4a69167BF0DC67A3F72C1C1B.
We never DM first, never ask for a seed phrase, and there is no airdrop or claim. A link anywhere else is not us.

**Cam, launch** (Tue 29, 16:00; the founder's call on 29 Sep: the site goes public with NEONCAM, the date follows at 20:00)
See yourself the way they see you.
NEONCAM turns your camera into a Face: five tones, from black to neon, the collection's own recipe. It all happens on your phone: nothing is uploaded.
Take yours on neonfaces.xyz and post it with #NEONCAM.

**Announce, neutral** (Tue 29, 20:00; the venue isn't in it, the site shows where to mint)
NEONFACES opens Thursday 1 October, 18:00 UTC.
The list goes first: 24 hours, 0.013 ETH, up to 3 Faces per wallet. Check your wallet on neonfaces.xyz
Then everyone, from Friday 2 October, 18:00 UTC: 0.018 ETH, up to 5 per wallet in total, until every Face is sold.
Every Face is a wallet with a small basket of Stock Tokens inside. Stock Tokens give economic exposure only, not legal ownership of shares; availability depends on where you live and on the issuer's terms.
(reply: the Safety post below)

**Plan B wording** (if the mint runs on neonfaces.xyz through SeaDrop, docs/LAUNCH-RUNBOOK.md 7; videos `make_launch.py --site announce howto today` -> out/l-announce-site.mp4, l-howto-site.mp4, l-today-site.mp4; the other pieces don't name the venue). The links go to https://neonfaces.xyz
- **Announce** NEONFACES opens on neonfaces.xyz: Thursday 1 October, 18:00 UTC. (the rest as above)
- **How to mint** step 3: Thursday 1 October, 18:00 UTC: mint on neonfaces.xyz
- **Today** Today, 18:00 UTC, on neonfaces.xyz. The list goes first, for 24 hours.
- **Open**, **Public**: the same text, with neonfaces.xyz in place of the drop's OpenSea link.
- One reply under the announcement: The mint runs through OpenSea's SeaDrop contract, the same one OpenSea's own drops use; your Faces show up on OpenSea and trade there.

Every person in these pieces was generated: like every face in the collection, they don't exist.

# Gold Coin Flip

A real 3D gold coin, rendered in WebGL, lit by a studio built in code, and
**thrown so that it lands on the side it was asked to**.

Live: <https://morattiyau-ctrlww.github.io/coin/>

---

## What changed, and why

The previous build was a flat 150 px disc with two faces and a CSS `rotateY`
keyframe. It had no thickness, so it vanished at the moment it turned edge-on;
it spun about the wrong axis for a coin; and `Math.random() < 0.5` picked a
result, after which an animation was played to match it. It looked like a coin
flip the way a coin flip looks on a slide.

This is a rebuild of the same idea, with the picture and the maths separated.

## The one interesting idea

**The rules decide the face first. Then the throw is *solved* to land on it.**
Not "animate to the result", and not "simulate and see what happened" — either
of those makes the picture a liar.

A coin toss is a whole number of half-turns. An even number leaves the original
face up; an odd number turns it over. So:

1. `RULES.flip()` picks the face from a byte of `crypto.getRandomValues`
   (256 equally likely values masked to one bit — exactly 128/128, no modulo
   bias, which is why the percentages on screen can be believed).
2. `WORLD.toss(result, rnd)` solves a throw that lands on it: it draws an
   airtime and a turn count, forces the parity to match the result, and sets
   the spin rate to `halfTurns * π / airtime`. At the instant of contact the
   coin has turned exactly an odd or even number of half-turns.
3. The renderer is *handed* that state. It never decides anything.

The check that matters is in the tests: **20 000 tosses, every one resting on
the decided face, every one lying flat, and the face the renderer actually
draws agrees with the model's.** The headless capture driver re-checks it in
the browser (`#cap=e2e`) against the coin's real world matrix.

### Two things that could have cheated, and do not

- **The free rotations.** The yaw and the roll are drawn at random and look
  lively, but they cannot change the face: a roll is about the coin's own face
  normal and a yaw is about the vertical, and either leaves the upward normal's
  vertical component untouched. Only the tumble decides, which is why the
  parity rule is the whole story.
- **Slow motion.** The descent eases into 0.28x speed so the last half-turn is
  readable. The state is a pure function of the *simulated* clock, so scaling
  time changes how it looks and not where it lands — a property the tests
  assert directly, by stepping the same toss 60 times and 600 times and
  requiring identical results.

## What is actually rendered

- **A coin, not two discs.** A lathed solid with a chamfered rim (24 cm across,
  22 mm thick — a showpiece, not a currency sim), 120 milled reeds on the edge
  as one instanced draw call, a raised ring and 88 beads per face, and the
  crown and bolt extruded from the same 2D paths the flat fallback and the
  tests use.
- **Gold is what it reflects.** `metalness: 1` means the material has no colour
  of its own — the colour comes entirely from a studio environment drawn
  procedurally as an equirectangular canvas and pre-filtered with PMREM. A dark
  room makes a dark coin; it is the mid-grey room with three bright panels that
  makes this read as gold. A canvas of micro-scratches doubles as the roughness
  and the bump map.
- **Lighting:** one warm key (the only shadow caster, so there is one clean
  shadow rather than a pile of weak ones), a cool rim to draw the edge, a warm
  floor bounce, and an impact flash whose intensity comes from the measured
  impact speed.
- **One camera.** A single continuous rig, never cut. Four scalars — azimuth,
  distance, height, aim — are damped toward what the shot wants, with the
  azimuth deliberately the slowest to move. The aim leads a falling coin, the
  way an operator would, because a follower chasing a steadily moving target
  settles behind it, and that lag is what would park the coin behind the HUD.
- **One composite pass:** bloom, filmic vignette, film grain, a whisper of
  chromatic aberration, with the grain applied *after* the sRGB conversion so
  it also dithers away 8-bit banding in a dark room.

## What was deliberately left out

- **The planar mirror.** The floor is a dark, slightly metallic stone that picks
  up the environment; it does not mirror the coin. A real reflection pass was
  the most expensive item in the plan for the least storytelling.
- **Depth of field.** A 24 cm coin at under a metre is in focus anyway.
- **The speed trail.** It was built, measured and removed. The cheap version is
  a stack of past poses, and a coin spends the top of its arc barely
  translating — so the stack collapses into a centred halo. A frame-stack also
  cannot express rotational blur, which is the blur a spinning coin actually
  has. It cost five draw calls to look worse. The milled edge turning through
  the light and the spin wash in the audio carry the speed instead.

## Sound

Thumb on metal, the milled edge washing as it turns, the edge on stone hit by
hit, a riser cut dead on the reveal, then a bright major stack for the crown or
a deep gong for the bolt.

Everything hangs off one graph, because a landing fires a burst of voices at
once:

```
voice -> bus gain -> glue compressor -> limiter -> master -> output
```

Noise voices are band-limited off a single pre-baked buffer, every voice has a
declared peak, there is a 24-voice cap, and mute is a ramp rather than a click.

## Fairness is on the screen

Lifetime flips, crown and bolt counts, a crown-share bar marked at 50%, the
current streak, the best streak, and the last five as chips. The tally counts
every flip you have ever made; the history keeps the last 40. Anyone who used
the old build keeps their results — `coinFlipHistory` is migrated on first load.
There are no timestamps, matching the previous change to the page.

## Accessibility

Space or Enter to flip (unless a button has focus), the verdict announced
through a live region, `aria-pressed` on the sound toggle, a labelled split bar,
visible focus rings, and `prefers-reduced-motion` honoured by dropping the slow
motion and the camera drift. The HUD is DOM text, not canvas pixels.

## Falling back

`?q=2d` — or a browser with no WebGL context, or three.js failing to load —
switches to a Canvas2D coin. It is not a cartoon stand-in: the silhouette is a
true orthographic projection of the same cylinder (an ellipse plus the edge
band), so a coin seen edge-on becomes a thin bar. Same model, same toss, same
outcome, same HUD, and it frames the shot the same way.

## Performance

Ten draw calls, about 11 000–15 000 triangles depending on the tier, with
`?q=low|med|high` pinning the budget (reed count, mesh segments, environment
size, shadows, bloom, pixel ratio). The tier is auto-detected from core count
and screen size.

## Files

| file | what it is |
| --- | --- |
| `world.js` | the coin and its toss. Pure maths: no DOM, no three.js |
| `script.js` | `RULES` (fairness, stats, migration), the audio engine, the loop, the capture driver |
| `renderer3d.js` | geometry, materials, environment, lights, the camera rig, post |
| `renderer2d.js` | the flat fallback |
| `tests/logic.test.js` | 70 headless checks |
| `vendor/three.min.js` | three.js r160, vendored |

## Running it

Any static server — it is plain files, no build step:

```sh
python3 -m http.server 8000
```

```sh
node tests/logic.test.js      # 70 checks, no browser needed
```

### The capture driver

`index.html#cap=…` pins a reproducible frame (seeded toss) and writes a JSON
report into `#probe`, `window.__coinProbe` and the document title:

| mode | what it pins |
| --- | --- |
| `idle` | the coin waiting on the stone |
| `flip` | rising, just past the top |
| `slowmo` | low on the way down, slow motion doing its work |
| `result` | settled, verdict up |
| `heads` / `tails` | either face flat under a straight-down inspector camera |
| `e2e` | 2000 solves plus real rendered tosses, checking the drawn face |
| `audio` | fires every voice and reports the graph |
| `help` | the list |

Add `&seed=123` to change the toss. The driver also reads pixels back at the
coin's own screen position — the check that caught the struck relief rendering
black on gold, which no thumbnail would have shown.


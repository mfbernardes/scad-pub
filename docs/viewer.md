# Viewer: framing and lighting

Long-form rationale for the two pieces of the 3D viewer that are mostly arithmetic:
`src/components/framing.ts` (where the camera goes) and `src/components/viewerRig.ts`
(what lights the model). The source keeps the invariants; this page keeps the derivations
and the tuning history behind the constants.

## Box-aware camera fit

`frameDistanceForBox` fits the model's axis-aligned bounding **box**, not a bounding
sphere. A sphere's radius is dominated by a flat, wide plate's diagonal, so
`radius * factor` leaves a typical plate reading at only ~30–40% of the pane, and it is
direction- and aspect-blind besides.

The camera looks at `target` from `target + direction * distance`. Project a world point's
offset from `target` onto the camera's own screen basis (`right`/`up`, both perpendicular
to `direction`): that gives a depth-independent screen-axis offset `q` and a depth-along-
view-axis offset `s`, so the point's actual depth from the camera is `distance - s`.
Requiring its projected size to stay within `fill` of the frame on that axis,

```text
|q| / ((distance - s) * tanHalf) <= fill
```

rearranges to a closed-form bound — no search or bisection:

```text
distance >= s + |q| / (tanHalf * fill)
```

Evaluating that for both screen axes at all 8 box corners and taking the max gives the
smallest distance at which every corner is within `fill` of the frame on both axes at
once. Because every corner is projected individually, an off-centre or asymmetric box
(`target` at the model's base rather than its centre — `Viewer.tsx`'s `restOnGrid` mode)
is handled correctly for free.

The whole module is plain arithmetic (three.js's `Vector3`/`Matrix4` need no WebGL
context), so it is unit-tested under `node:test` in `tests/framing.test.mjs`.

`DEFAULT_FIT_FRACTION` (0.66 × 0.58) is the "product shot" target, verified against a flat
plate, a tall thin model and a cube from every standard view.

### Extreme-aspect correction

The fit takes the tighter of the two axes, which is correct, but says nothing about the
other axis — and on a canvas far from square that axis can be left almost empty.

The motivating case is a phone in portrait: the viewer is a tall column (390 × ~730,
aspect ~0.53) and these designs are wide flat plates, so the width target always binds.
The model occupied 66% of the width and under a quarter of the height, reading small in a
mostly-empty frame. The mirror case exists too — the bottom sheet's Full detent leaves a
short, wide strip (aspect ~3) where height binds and width is empty.

So when a canvas is far enough from square that one axis provably cannot bind,
`aspectAwareFit` raises the binding axis's target by `sqrt(aspect)` — smooth rather than
stepped — and caps it (`MAX_WIDTH_FIT`, `MAX_HEIGHT_FIT`, both below 1.0 by a real margin)
so the model still reads as a framed object rather than something cropped at the edges.

Aspects inside the neutral band (0.8–1.6) are left exactly alone. That band covers every
ordinary desktop pane and the mobile half detent, so the correction changes nothing about
the framing tuned against the plate/tall-model/cube set: it only rescues the two extremes.

### Chrome insets

The viewer's floating chrome — export dock, HUD button column, mobile top bar,
measurements panel — overlays the canvas rather than shrinking it (everything is
`position: absolute`, so none of it affects the canvas's own flex-computed size). A model
fitted to the full canvas therefore sits partly behind it.

`Viewer.tsx`'s `frameView` fixes that with two moves together:

1. `insetFitFraction` shrinks the fit's targets by each axis's inset share, so the box is
   asked to fit the *usable* region rather than the full canvas.
2. `insetTargetOffset` shifts the orbit target so the box, unchanged in world space,
   renders centred in that usable region.

The insets are a rect, not a single bottom scalar, because the chrome is not only at the
bottom: the HUD is a right-edge column tall enough to cover most of a short mobile
viewport, and the top bar spans the full width above the model.

`edgeInset` charges an overlay to the edge it intrudes from *least*, by that intrusion's
depth: a bottom-centred dock reaches only ~55px up from the bottom but ~730px down from
the top, so it reads as a bottom inset. That rule is right for a band spanning one whole
side and worst for a **corner** box, where the winning edge over-counts the other axis. A
corner overlay's right answer depends on what else is on screen (charging the mobile HUD's
trigger to the top is only cheap because the top bar already reserves a band there), which
`framing.ts` cannot see — so the choice stays with the caller (`singleEdgeInset`, and
`Viewer.tsx`'s `CHROME_OVERLAYS`) and only the arithmetic lives here, tested. The
measurements panel is the other corner box, and it is left out of the fit entirely.

`clampInsets` keeps `MIN_USABLE_FRACTION` (0.55) of each axis clear: a short landscape
viewport can stack the top bar, dock and HUD over barely 190px of canvas, and honouring
every inset there would shrink the model to a dot. Better to let some chrome overlap than
to make the model unreadable.

`insetTargetOffset` returns *half* the difference of the opposing insets, not their sum:
with only the bottom edge inset, the usable region's centre sits `bottom / 2` above the
canvas centre. The returned scalars are applied with no negation at the call site — the
sign flip is folded in here, because the camera always keeps `target` at the exact centre
of the frame, so making a stationary model appear *higher* on screen means moving the
target the other way. Hence a bottom inset yields a negative `up`. One `worldPerPixel`
serves both axes because pixels are square: the horizontal world-per-pixel is
`2·distance·tanHalfH / width`, and with `tanHalfH = aspect·tanHalfV` and
`aspect = width/height` that reduces to the vertical expression.

## The studio lighting rig

`buildStudioRig` has two branches. The `plain` one is a hemisphere light carrying most of
the fill so near-white surfaces read close to their true colour instead of collapsing to
grey; the rest of this section is about `studio`.

### Why top-vs-side separation is the whole target

The step in luminance between a top face and the wall beside it is the only reason a
printed plate reads as a solid a few millimetres thick instead of a flat sticker. The
meshes are flat-shaded, so that step draws a crisp line along every top edge.

Getting it takes an environment that is genuinely top-biased. three's `RoomEnvironment` is
not: it is an enclosed room whose walls carry most of its light, and measured against this
scene its irradiance on a vertical wall is ~1.17× what a top face gets — exactly the
sticker look. So the environment is built here instead, as a soft overhead field over a
small uniform base (a softbox above a product): a back-facing sphere whose fragment
radiance depends only on elevation, PMREM-filtered like any other environment scene. That
costs one small render at startup and nothing per frame, downloads nothing, and stays
neutral in colour so a near-white plate stays white and a red relief is unshifted. Values
are linear and may exceed 1 (PMREM renders into a half-float target).

Tone mapping is Khronos PBR Neutral, which stays near-identity for mid-tones so the
model's own colours and the themed background survive faithfully; ACES would hue-shift
saturated colours.

Totals put a top face at about full albedo. A plate's outer wall stays visibly darker than
its top on every side; the tightest case is the one wall facing the key directly, landing
around four-fifths of the top's measured brightness against the roughly-half a wall facing
away sits at. That is narrower than the single-key rig it replaced, but checked against
real renders in both themes. **If any constant below moves, recheck a plate's four walls
against its top, not just a letter's two bevels.**

### `ENV_OVERHEAD` / `ENV_BASE`

Their balance sets the top-vs-side ratio. The overhead field reaches a vertical wall at
only ~0.27 of what it gives a top face, while the base reaches every direction equally, so
raising the base lifts the walls (and undersides) without touching the top by much.

`ENV_OVERHEAD` is trimmed from 0.97 to make room for the key/fill pair. The field depends
only on elevation, so two faces at the same elevation get identical radiance from it *no
matter* their azimuth: rotating the whole field about world Z (its axis of symmetry)
leaves it unchanged, so by construction it cannot see the difference between a prismatic
letter-stroke's two opposing ~45° bevels. Reclaiming some of the field's headroom lets the
key/fill pair be strong enough to matter without blowing out the top face.

`ENV_EDGE0`/`ENV_EDGE1` are the angular softness of the field's edge, as cosines of the
angle from "up": wide and soft, so curved geometry (rivet heads, letter bevels) shades
smoothly.

### `ENV_ROTATION_X`

The environment is authored Y-up (the equirect/scene convention three's environments use)
and mapped onto this Z-up world by `scene.environmentRotation`. The sign in the source is
the one that actually lands the bright pole on world +Z: three inverts and re-flips the
Euler on its way to the shader (see `WebGLMaterials`' `refreshTransformUniform`), so it is
not the sign the Euler alone suggests. Verify by eye, not by derivation.

`studioEnvIntensity` reads the live document theme — the same source of truth the CSS
variables key off — so scene setup and theme switches always agree. Note that it drives
`scene.environmentIntensity`, not the materials' `envMapIntensity`: with a scene-level
environment three overwrites the material value with the scene's (see `WebGLRenderer`'s
`setProgram`), so the per-material knob is inert on this path.

### Key + fill: the only azimuthally-aware lights

Prismatic lettering (`roof()`-cut strokes) is a ridge of two ~45° bevels at the same
elevation but opposite azimuths. The environment is a function of elevation only, so
whatever separates them must come from a light with an azimuth of its own. Two design
choices follow.

**Neither light's azimuth may line up with the camera's.** The default camera sits at
world azimuth ≈ −59° (`VIEW_DIRECTIONS.isometric`); a light near that azimuth lights the
two visible bevel faces almost equally — both lean towards the viewer/light together —
which is the flat, un-emphasized look this rig replaces. KEY sits on world +X (azimuth 0°)
and FILL on world −Y (azimuth −90°): respectively ~59° and ~31° from the camera's azimuth,
and 90° from each other, so between them almost every stroke direction gets a lit bevel
and a shaded one rather than two equally-grey ones — the vertical stems that dominate
digits via KEY, the horizontal and curved strokes via FILL. FILL is deliberately the weaker
of the pair: it exists so no stroke direction reads as perfectly flat, not to compete with
KEY over which family of strokes reads most strongly.

**Both sit at a low elevation** (14°/10°) rather than the old single key's ~55°. What a
shallow angle buys is efficiency, not raw contrast. At any elevation below 45° the ridge's
shaded bevel faces away and gets nothing from the light at all, while the lit one catches
`cos(45° − elevation)`, which shrinks only mildly as the light drops. The leak onto the top
face — the thing that must stay near-white — is `sin(elevation)`, which collapses near the
horizon. Bevel contrast per unit of top-face headroom spent therefore rises steeply at low
elevation, which is why `ENV_OVERHEAD` needed only a modest trim rather than a large one.

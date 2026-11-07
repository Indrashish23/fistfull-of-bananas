---
name: tripo-models
description: Generate rigged, stylized game characters with the Tripo CLI from renders of our current models, flatten them to the game's flat colours, and list what the main game must replace. Use when the user asks to generate, prompt, or make a 3D model or character with Tripo, or to swap a boss or lizard for a generated one.
---

# Making characters with Tripo

The `tripo` CLI (`npm install -g tripo-cli`, published under Tripo's `vast-enterprise` GitHub org) does the generating. Our own tools handle the two things it can't: reference sheets of our characters, and turning its output into our flat colours.

**Generate from a description, not from reference sheets.** In Tripo Studio, description-based generation gave far better characters than our low-poly renders did, which came out as stiff copies of them. Studio credits don't work with the CLI, whose API balance is separate, so the Studio route below is the one that has worked. Everything after "Setup" describes the older CLI route, which has only ever been dry-run.

## The Studio route (what has worked)

In `studio.tripo3d.ai/workspace/generate`:

1. **Model > Smart Mesh > the pencil tab.** Topology Quad, polycount 2000 (about 4,000 triangles), 4 variants (100 credits, same price as 1). Turn on **T-Pose**. Describe proportions, clothes and colours, and ask for a smooth blank face with no eyes, teeth, nostrils or sculpted detail. Keep it original: never name an existing character.
2. Look at all four from the side, then **Texture** the pick (30). Then **Rig**: Humanoid, Mixamo (20).
3. **Export** as GLB at 2K with the skeleton, into `lookdev/tripo/out/<id>/`. Get the user's OK before each spend and before the download.
4. **Fit it to the game:** the model needs repainting in outfit materials, its painted and sculpted eyes removed, the 21 game bones and retargeted clips. Tripo's humanoid rig hangs the tail off a thigh, so the tail needs its own bones. A first version of this was tried on a lizard and then removed, because the user kept the in-house Blender lizard. Nothing in the repo does this step today.

Faces are always our flat SVG art, baked onto the head with `bake_face`. Stretching the sheet tall (eyes at the old eye spots, mouth near the snout's tip) keeps the grin off the top of a downward snout. Weapon grips (`heldMatrix`) assume the monkey's hand position, so a model with different proportions needs its own.

## The CLI route

Generate from references of our current models. Our enemies use simple, chunky low-poly topology, so ask for low face counts: `-p face_limit=4000`, and check the plan with `--dry-run`.

## Setup (the user does this once)

```bash
tripo login --region ov
```

It opens a browser and the key arrives by itself. Never ask for the key in chat, and never print it. Check with `tripo whoami`. API credits may be separate from a Tripo Studio subscription; `tripo balance` shows what's actually available.

## Spending rules

Credits are real money and non-refundable (1 credit = $0.01). Anything with `--dry-run` is free, so always run that first. Tell the user the plan and the rough total, and get their OK before each real run. Approval for one batch doesn't cover the next. Failed tasks aren't charged.

From Tripo's pricing page: multiview to 3D with texture is 30 credits, rigging 25, and a rig check free. So one rigged character is about 55 credits ($0.55). `--dry-run` picks the model version, and costs can differ by version, so check `tripo balance` before and after the first run.

## The steps

Run these from the repo root.

1. **Make fresh reference sheets.** Renders front, left, back and right of the gator, snake, bird and lizard into `lookdev/tripo/refs/`, which git ignores:

   ```bash
   "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup --python lookdev/blender/tripo_refs.py
   ```

   Faces, weapons and the sack are left out on purpose: the game draws faces as flat art, and weapons are added in the build script.

2. **Dry-run, then generate and rig.** Keep the order front, left, back, right. Each result lands in its own folder:

   ```bash
   tripo make lookdev/tripo/refs/gator/front.png lookdev/tripo/refs/gator/left.png lookdev/tripo/refs/gator/back.png lookdev/tripo/refs/gator/right.png --for anim --then rig --dry-run
   tripo make lookdev/tripo/refs/gator/front.png lookdev/tripo/refs/gator/left.png lookdev/tripo/refs/gator/back.png lookdev/tripo/refs/gator/right.png --for anim --then rig -o lookdev/tripo/out/gator
   ```

   For a new character in the same style, make its concept from a reference first. Keep it original: style inspiration is fine, but don't name or copy an existing character.

   ```bash
   tripo generate image-to-image lookdev/tripo/refs/lizard/front.png --prompt "the same flat-colour style as image[1], but a ..." -o lookdev/tripo/out/new
   ```

3. **Flatten and look.** Writes `flat.glb`, `flat.palette.json` and `flat.png` (front, three-quarter and side) beside the model. Our faces are always flat SVG art, so for a rigged model this also paints out its own eyes and mouth and writes `flat.face.json`, a face sheet for `buildFaceGrid`. If the model has a face sculpted into its shape, like a deep mouth or bulging eyes, smooth that out in Blender too. Read `flat.png` and show the user. If the side view faces the wrong way, rerun with `--forward=-y`. Use `--colors` for fewer or more solid colours.

   ```bash
   node lookdev/tripo/flat.mjs lookdev/tripo/out/gator/<the rigged glb>
   ```

4. **Fit it to the game.** Flattening cuts the rig to the engine's limit of 24 bones. Then:
   - **Boss:** copy `flat.glb` to `lookdev/assets/bosses/<id>.glb`, and use `flat.palette.json` as its `paint` in `lookdev/bosses.ts`. It needs `idle`, `pose` and `fire` clips (Big Gat also `steal`): author them with `Poser` in `lookdev/blender/build_bosses.py`, using `soften=False` so the rig's weights aren't blurred, and check its `STRETCH` report. Bake a new face sheet with `bake_face`.
   - **Lizard:** the home screen reads the `Reptile` mesh in `lookdev/assets/monkey.glb`, on the monkey's exact 21 bones, because clips and the ragdoll depend on them. A generated lizard's bones won't match, so its mesh must be re-weighted to those bones in `lookdev/blender/build_rigs.py`. Check the home screen's sign poses and ragdoll afterwards.

5. **Hand over.** Add to `lookdev-rig-changes.md` in the session notes folder, for the main thread: which `.glb` files changed, any new paint or clips, and what to re-test. The game imports `lookdev/` directly, so it picks up replaced files by itself.

## Known limits

- Nothing has run against the live API yet: only `--dry-run`. On the first real run, check the output's facing, the rig's bone names, and that `flat.png` looks right.
- Tripo's terms give paid users rights in their outputs, while free users' outputs carry far weaker rights. Confirm the user's plan before shipping anything.

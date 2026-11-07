# Fistfull of Bananas

A Wild West shooting gallery for the Little TV. You're a monkey with a revolver, and the lizards are coming up
the street. Point your arm at the screen to aim, press OK on the remote to shoot, and fight your way through
three waves to Big Gat, the gator at the bank.

It's a normal website, so it also plays in a browser with a mouse.

## How to play

| | On the TV | In a browser |
|---|---|---|
| Aim | Point your arm at the screen | Move the mouse |
| Shoot | OK on the remote | Click |
| Reload | Shake your hand | R |
| Lean out of the way | Lean your body | A and D |
| Duck | Crouch | S |
| Skip, or leave a run | Back on the remote | Esc |

Each time it opens, a camera check makes sure the TV can see you. The first time, a short tutorial then
teaches you to aim, using a lizard who won't fight back.

## What you need

- **Node 22 or newer.**
- **Access to the Little developer packages.** The game uses `@kabletv/little-sdk` and `@kabletv/little-motion`,
  and they're private on GitHub Packages for now. You need a GitHub token with `read:packages` for the
  `kabletv` org. If you have the `gh` CLI, `gh auth token` gives you one. The repo's `.npmrc` already points
  npm at the right place, and only reads the token from your environment.
- **The Little CLI**, to run it in the simulator or on a TV. See the
  [CLI quickstart](https://docs.little.co/docs/cli/quickstart).
- **A JDK 17 or newer**, for the simulator only.
- **A Little TV**, to play it with the camera.

## Run it in a browser

```bash
export NODE_AUTH_TOKEN=$(gh auth token)
npm install
npm run dev
```

Then open http://localhost:7140. On Windows PowerShell, set the token with
`$env:NODE_AUTH_TOKEN = (gh auth token)` instead.

## Run it in the Little simulator

```bash
little dev
```

This starts the dev server and opens the game in the simulator. To aim with your webcam there, add `?track` to
the app's address. Otherwise the mouse aims.

## Play it on a Little TV

Pair the TV once. The code shows on the TV:

```bash
little device pair
```

For the smoothest game, build it and serve the build to the TV. Your computer and the TV need to be on the
same network. Use your computer's address on that network in place of `192.168.0.70`:

```bash
npm run build
npx vite preview --host 0.0.0.0 --port 7140 --strictPort
little dev --device vim4 --app-url "http://192.168.0.70:7140/"
```

Run the last command in a second terminal while the preview's serving. While you're working on the game,
`little dev --device vim4` on its own runs the dev server instead, and the TV reloads whenever you save.
It's slower, though.

Add `?perf=1` to the address to print the frame rate to the terminal every two seconds.

## Tests

```bash
npm test
```

## What's where

- `src/game` has the rules: waves, enemies, the boss, aim assist, the tutorial and the camera check. None of it
  touches the page, so it's all tested.
- `src/render` draws the game, and `src/ui` is the HUD and screens.
- `src/input` turns the camera's readings into aiming, leaning, ducking and shaking.
- `src/audio` has the sound effects and the music, all real recordings.
- `lookdev` has the models, the art style and the Blender scripts that build the characters.
- `public/little/manifest.json` tells the TV what the game is, and what the TV's assistant can do in it.

## Credits

The sounds, music, guns and arms are all CC0 recordings and models, each credited in a file beside it:

- `src/audio/clips/CREDITS.md` and `src/audio/music/CREDITS.md`
- `lookdev/assets/guns/CREDITS.md`, `lookdev/assets/revolvers/SOURCE.md` and `lookdev/assets/fps_arm_source/SOURCE.md`

The fonts are Rye and Bitter, under the SIL Open Font License.

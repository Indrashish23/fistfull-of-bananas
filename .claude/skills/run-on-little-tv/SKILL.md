---
name: run-on-little-tv
description: Run a Little app on a real Little TV (Khadas VIM4 dev device) from this computer, and check it there with logs, screenshots and remote presses. Use when the user asks to test, run or push the game on the TV or VIM4, or asks why something works in the simulator but not on the TV.
---

# Running the game on the Little TV

The simulator and the TV run the same page, so use the simulator for everyday work. Use the TV for what the simulator can't tell you: camera tracking, frame rate and how the screen reads from a couch.

## Start it

Pair once. The pairing lasts about a month, and the code shows on the TV:

```bash
little device pair
```

Then run it. This starts the dev server if nothing is serving port 7140. The TV reloads whenever a file is saved:

```bash
little dev --device vim4
```

Run it in a Terminal panel tab so the user can see it. The app's console prints in that tab.

If it says "the linked app is not your publisher's", rename `little.json` so the project runs unlinked. This project keeps it as `little.json.linked` for now.

## Rules that caught us out

- **Capabilities are read at start.** After changing `capabilities` or `tools` in the manifest, stop and rerun `little dev --device vim4`. Saving isn't enough.
- **Camera tracking works over plain http.** `sense.motion` runs fine that way. `media.camera` and `media.mic` need https, which means `--app-url https://...` on an origin the publisher has verified.
- **The remote sends OK with an empty keyboard code:** `key=Enter code=`. Read `e.key` for Enter, Escape and the arrows, and never `e.code` alone. The arrows do carry a code, which hides the bug.
- **The remote only has six keys:** the arrows, Enter and Escape. It has no motion sensor, and there's no API for its talk button: holding that sends audio to the TV's assistant and silences the app's mic.
- **The app can end up behind the Home screen.** If the log shows `hidden=true` and 0 fps, the game has gone to the background. Rerun the command to bring it back.
- **Saving a file reloads the TV,** which interrupts anyone playing. Batch edits, and say so before saving.
- **Vite config changes restart the server.** The TV reconnects by itself.
- **Stopping the TV run also stops the dev server** if that run started it, which breaks a simulator sharing it.

## Check it without a person

Read the log first. In development the game prints a line every 2 seconds:

```
[ragebait] 38 fps, 29 draws, hidden=false, phase=aim, tracking=tracking arm=0.47,0.40 lean=-0.20
```

That's the frame rate, the game phase and what the camera sees. On this device, expect about 60 fps without tracking and 31 to 40 with it.

`adb` is the way in for everything else. `S` is the device's serial, from `adb devices`, and the TV must be on the same network:

```bash
adb -s "$S" exec-out screencap -p > tv.png
```

```bash
adb -s "$S" shell "input keyevent DPAD_RIGHT DPAD_RIGHT DPAD_CENTER"
```

```bash
adb -s "$S" shell "dumpsys window | grep mCurrentFocus"
```

`AppActivity` in that last output means the game is in front, and `HomeActivity` means the Home screen is.

Read the screenshot to check the result. Each `input keyevent` is a very short tap, so it moves an arrow-key aim only a little. To jump into a mode, fire one of the app's own tools, which reaches the TV too:

```bash
little dev call start_showdown '{"players":1}' --json
```

Firing a tool or sending presses interrupts whoever is playing, so check the log for their key presses first.

Things a person still has to check: anything that needs a body in front of the camera, like arm aim, leaning and crouching, and sound.

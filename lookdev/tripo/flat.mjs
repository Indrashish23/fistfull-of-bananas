#!/usr/bin/env node
// Turns a model from the Tripo CLI into our flat colours, beside the original. See
// .claude/skills/tripo-models/SKILL.md.
//
//   node lookdev/tripo/flat.mjs <model.glb> [--colors 10] [--height 5] [--forward=-y]

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BLENDER = process.env.BLENDER ?? "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe";

const [input, ...flags] = process.argv.slice(2);
if (!input || !existsSync(input)) {
  console.error("Usage: node lookdev/tripo/flat.mjs <model.glb> [--colors 10] [--height 5] [--forward=-y]");
  process.exit(1);
}
const out = path.join(path.dirname(path.resolve(input)), "flat");
const script = path.join(ROOT, "lookdev", "blender", "tripo_flat.py");
const run = spawnSync(BLENDER, ["--background", "--factory-startup", "--python", script, "--", path.resolve(input), out, ...flags], { encoding: "utf8", maxBuffer: 1 << 28 });
const report = (run.stdout ?? "").split(/\r?\n/).filter((l) => l.startsWith("FLAT") || /Error|Traceback/.test(l));
console.log(report.join("\n"));
if (run.status !== 0 || !existsSync(`${out}.png`)) {
  console.error("The flat step failed. Run Blender directly with the same arguments to see why.");
  process.exit(1);
}
console.log(`Look at ${out}.png`);

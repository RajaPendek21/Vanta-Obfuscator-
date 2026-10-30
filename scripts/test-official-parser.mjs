import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const compiler = process.env.LUAU_COMPILE_PATH ?? "luau-compile";
const valid = resolve("tests/luau/official-parser-valid.luau");
const invalid = resolve("tests/luau/official-parser-invalid.luau");
const good = spawnSync(compiler, [valid], { encoding: "utf8", timeout: 10_000 });
if (good.error) throw new Error(`Official Luau compiler unavailable: ${good.error.message}`);
if (good.status !== 0) throw new Error(`Official Luau parser rejected valid fixture:\n${good.stderr}`);
const bad = spawnSync(compiler, [invalid], { encoding: "utf8", timeout: 10_000 });
if (bad.error) throw bad.error;
if (bad.status === 0) throw new Error("Official Luau parser unexpectedly accepted invalid fixture.");
console.log("Official Luau parser fixtures passed.");

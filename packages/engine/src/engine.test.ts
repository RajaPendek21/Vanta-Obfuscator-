import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { obfuscateWithObscura, validateWithOfficialLuau } from "./index.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const obscuraRoot = process.env.OBSCURA_ROOT ?? resolve(projectRoot, "vendor/obscura");
const hasObscura = existsSync(resolve(obscuraRoot, "obfuscator.py"));
if (process.env.REQUIRE_OBSCURA_TESTS === "1" && !hasObscura) {
  throw new Error(`Pinned Obscura checkout missing at ${obscuraRoot}; refusing to skip the engine test.`);
}

test("Obscura PARANOID mode generates a VM-protected Luau chunk", { skip: !hasObscura }, async () => {
  const source = "local answer = 42\nreturn answer";
  const result = await obfuscateWithObscura(source);
  assert.ok(result.code.length > 0);
  assert.notEqual(result.code, source);
  assert.match(result.code, /-- Obscura VM/);
  assert.ok(result.stats.outputBytes > 0);
  assert.equal(result.stats.inputBytes, Buffer.byteLength(source, "utf8"));
  await validateWithOfficialLuau(result.code);
});

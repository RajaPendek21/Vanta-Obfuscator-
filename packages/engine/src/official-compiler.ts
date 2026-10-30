import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class LuauCompilerUnavailableError extends Error {
  constructor() {
    super("Official Luau compiler is unavailable. Install the Luau toolchain or run the API container.");
    this.name = "LuauCompilerUnavailableError";
  }
}

/** Validate source with Roblox's official Luau compiler (the parser is part of the compiler frontend). */
export async function validateWithOfficialLuau(source: string): Promise<void> {
  const executable = process.env.LUAU_COMPILE_PATH ?? "luau-compile";
  const directory = await mkdtemp(join(tmpdir(), "vanta-luau-"));
  const file = join(directory, "input.luau");
  try {
    await writeFile(file, source, { encoding: "utf8", flag: "wx" });
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, [file], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      let diagnostics = "";
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      };
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", chunk => { diagnostics = (diagnostics + chunk).slice(-12_000); });
      child.stderr.on("data", chunk => { diagnostics = (diagnostics + chunk).slice(-12_000); });
      child.once("error", error => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") finish(new LuauCompilerUnavailableError());
        else finish(error);
      });
      child.once("close", code => code === 0 ? finish() : finish(new Error(diagnostics.trim() || `Luau compilation failed (exit ${code}).`)));
      const timer = setTimeout(() => { child.kill("SIGKILL"); finish(new Error("Luau compilation timed out.")); }, 8_000);
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

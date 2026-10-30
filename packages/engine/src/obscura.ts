import { spawn } from "node:child_process";
import { resolve } from "node:path";

export interface ObscuraResult {
  code: string;
  warnings: string[];
  stats: { inputBytes: number; outputBytes: number; tokens: number; reductionPercent: number };
}

/** Run the pinned Obscura engine (including its VM pipeline) in a separate Python process. */
export async function obfuscateWithObscura(source: string): Promise<ObscuraResult> {
  if (!source.trim()) throw new Error("Source code is empty.");
  if (Buffer.byteLength(source, "utf8") > 100_000) throw new Error("Source exceeds the 100 KB build limit.");

  const python = process.env.PYTHON_PATH ?? "python3";
  const adapter = process.env.OBSCURA_ADAPTER_PATH ?? resolve(process.cwd(), "packages/engine/python/obscura_adapter.py");
  const child = spawn(python, [adapter], {
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });

  return await new Promise<ObscuraResult>((resolvePromise, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error, result?: ObscuraResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolvePromise(result!);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdout += chunk;
      if (stdout.length > 2_000_000) {
        child.kill("SIGKILL");
        finish(new Error("Obscura output exceeded the 2 MB limit."));
      }
    });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-12_000); });
    child.once("error", error => finish(new Error(`Could not start Obscura. Ensure Python 3 is installed: ${error.message}`)));
    child.once("close", code => {
      if (code !== 0) return finish(new Error(stderr.trim() || `Obscura exited with code ${code}.`));
      try {
        const parsed = JSON.parse(stdout) as { code?: unknown; warnings?: unknown };
        if (typeof parsed.code !== "string") throw new Error("Obscura returned an invalid result.");
        const inputBytes = Buffer.byteLength(source, "utf8");
        const outputBytes = Buffer.byteLength(parsed.code, "utf8");
        const tokens = source.match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[^\s]/g)?.length ?? 0;
        finish(undefined, {
          code: parsed.code,
          warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((v): v is string => typeof v === "string") : [],
          stats: { inputBytes, outputBytes, tokens, reductionPercent: inputBytes ? Math.max(0, Number(((1 - outputBytes / inputBytes) * 100).toFixed(2))) : 0 }
        });
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Could not parse Obscura output."));
      }
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("Obscura exceeded the 60-second build timeout."));
    }, 60_000);
    child.stdin.on("error", error => finish(new Error(`Could not send source to Obscura: ${error.message}`)));
    child.stdin.end(source, "utf8");
  });
}

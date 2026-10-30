export interface BuildRequest { source: string; target: "luau" }
export interface BuildStats { inputBytes: number; outputBytes: number; tokens: number; reductionPercent: number }
export interface BuildAccepted {
  buildId: string;
  status: "queued" | "running" | "completed" | "failed";
  message: string;
  output?: string;
  stats?: BuildStats;
  warnings?: string[];
}
export interface ApiHealth { status: "ok" | "degraded"; service: "vanta-api"; version: string; engine: string }

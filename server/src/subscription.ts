/** Claude-subscription status for the grader. Mirrors the ai-contact-bun
 * "Connect Subscription" pattern: detect the local `claude` CLI, then verify it
 * can actually answer (i.e. logged into a subscription). No API key is used. */
import { join, resolve } from "node:path";

const DATA_DIR = process.env.DATA_DIR || resolve(import.meta.dir, "../data");
const PREF_PATH = join(DATA_DIR, "subscription.json");

export interface CliInfo {
  detected: boolean;
  path: string | null;
  version: string | null;
}

/** Detect the `claude` binary the grader shells out to. */
export function detectClaudeCli(): CliInfo {
  try {
    const which = Bun.spawnSync(["which", "claude"]);
    const path = which.exitCode === 0 ? new TextDecoder().decode(which.stdout).trim() : "";
    if (!path) return { detected: false, path: null, version: null };
    let version: string | null = null;
    try {
      const v = Bun.spawnSync(["claude", "--version"]);
      if (v.exitCode === 0) version = new TextDecoder().decode(v.stdout).trim() || null;
    } catch {
      /* version optional */
    }
    return { detected: true, path, version };
  } catch {
    return { detected: false, path: null, version: null };
  }
}

/** Verify the CLI actually responds (= logged into a subscription), no API key. */
export async function testClaudeWorks(timeoutMs = 30_000): Promise<boolean> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  const proc = Bun.spawn(["claude", "-p", "Reply with only: OK", "--model", "haiku"], {
    stdout: "pipe",
    stderr: "ignore",
    env: env as Record<string, string>,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("timeout"));
    }, timeoutMs);
  });
  try {
    const [code, out] = await Promise.race([
      Promise.all([proc.exited, new Response(proc.stdout).text()]),
      timeout,
    ]);
    return code === 0 && out.trim().length > 0;
  } catch {
    proc.kill("SIGKILL");
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface Pref {
  enabled: boolean;
  connectedAt: string | null;
}
async function readPref(): Promise<Pref> {
  try {
    const f = Bun.file(PREF_PATH);
    if (!(await f.exists())) return { enabled: false, connectedAt: null };
    const j = (await f.json()) as Partial<Pref>;
    return { enabled: Boolean(j.enabled), connectedAt: j.connectedAt ?? null };
  } catch {
    return { enabled: false, connectedAt: null };
  }
}
async function writePref(p: Pref): Promise<void> {
  await Bun.write(PREF_PATH, JSON.stringify(p, null, 2));
}

export interface SubscriptionStatus {
  mode: "subscription" | "not-connected";
  subscriptionEnabled: boolean;
  connectedAt: string | null;
  hasApiKey: boolean;
  claudeCli: CliInfo;
}

export async function getStatus(): Promise<SubscriptionStatus> {
  const pref = await readPref();
  const cli = detectClaudeCli();
  return {
    mode: pref.enabled ? "subscription" : "not-connected",
    subscriptionEnabled: pref.enabled,
    connectedAt: pref.connectedAt,
    hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    claudeCli: cli,
  };
}

/** Connect = detect CLI + verify it actually answers, then persist the flag. */
export async function connect(): Promise<SubscriptionStatus> {
  const cli = detectClaudeCli();
  if (!cli.detected) {
    throw new Error("`claude` CLI not found. Install it and log into Claude Max first.");
  }
  const works = await testClaudeWorks();
  if (!works) {
    throw new Error("`claude` CLI found but did not respond — run `claude` once to log into your subscription.");
  }
  await writePref({ enabled: true, connectedAt: new Date().toISOString() });
  return getStatus();
}

export async function disconnect(): Promise<SubscriptionStatus> {
  const prev = await readPref();
  await writePref({ enabled: false, connectedAt: prev.connectedAt });
  return getStatus();
}

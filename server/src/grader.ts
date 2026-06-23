/** Model-based grader running on the LOCAL Claude subscription (no API key).
 * Spawns the `claude` CLI in print mode and parses a JSON verdict. */
import type { Verdict } from "./types";

function buildPrompt(rubric: string, input: string, expected: string, answer: string): string {
  return `You are grading a customer-service bot's answer against a known-correct reference.

<rubric>
${rubric}
</rubric>

<question>
${input}
</question>

<reference_answer>
${expected}
</reference_answer>

<bot_answer>
${answer}
</bot_answer>

Grade the bot answer against the reference using the rubric. Reply with ONLY a JSON
object — no markdown fences, no prose before or after — with the fields in EXACTLY
this order so you reason before deciding:
{"reason": "<one or two sentence explanation>", "pass": <true or false>, "score": <integer 1-10>}`;
}

/** Pull the first {...} JSON object out of arbitrary text. Exported for tests. */
export function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Run `claude -p <prompt> --model <model>` on the subscription. Throws on failure/timeout. */
async function runClaude(
  prompt: string,
  model: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  // Strip API-key env so the CLI uses the Max SUBSCRIPTION, never the paid API.
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;

  const proc = Bun.spawn(["claude", "-p", prompt, "--model", model], {
    stdout: "pipe",
    stderr: "pipe",
    env: env as Record<string, string>,
  });

  // Run aborted (Cancel / client disconnect) → kill the grader subprocess now,
  // instead of letting it run to its 120s timeout.
  const onAbort = () => proc.kill("SIGKILL");
  signal?.addEventListener("abort", onAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      proc.kill("SIGKILL"); // SIGTERM can be trapped/delayed by the CLI → force-kill
      reject(new Error(`claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    // Drain stdout+stderr concurrently (no pipe backpressure / reader leak), and
    // race the whole thing against the timeout so a wedged process can't hang a worker.
    const [exitCode, out, err] = await Promise.race([
      Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]),
      timeout,
    ]);
    if (exitCode !== 0) {
      throw new Error(`claude CLI exited ${exitCode}: ${(err || out).slice(0, 200)}`);
    }
    return out;
  } catch (e) {
    proc.kill("SIGKILL"); // ensure no orphaned process on any error path
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Grade one answer. Returns a verdict; throws if the grader output is unparseable. */
export async function gradeAnswer(
  rubric: string,
  input: string,
  expected: string,
  answer: string,
  model: string,
  timeoutMs = 120_000,
  signal?: AbortSignal,
): Promise<Verdict> {
  const base = buildPrompt(rubric, input, expected, answer);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) break; // don't spawn another grader for an abandoned run
    const prompt = attempt === 0 ? base : `${base}\n\nIMPORTANT: output ONLY the raw JSON object.`;
    const out = await runClaude(prompt, model, timeoutMs, signal);
    const parsed = extractJson(out);
    if (parsed && typeof parsed.pass === "boolean" && typeof parsed.score === "number") {
      return {
        pass: parsed.pass,
        score: Math.max(1, Math.min(10, Math.round(parsed.score))),
        reason: typeof parsed.reason === "string" ? parsed.reason : "",
      };
    }
  }
  throw new Error(`grader produced unparseable output for: ${input.slice(0, 50)}`);
}

/** "Prompt mode" target: get an answer from a SYSTEM PROMPT on the LOCAL Claude
 * subscription (no API key, $0) — the Workbench-style path. Spawns
 * `claude -p <question> --system-prompt <sys> --model <model>`. The flag applies
 * only to this throwaway subprocess; it never touches the user's Claude config. */

export async function askPrompt(
  systemPrompt: string,
  userMessage: string,
  model: string,
  timeoutMs = 120_000,
  signal?: AbortSignal,
): Promise<string> {
  // Strip API-key env so the CLI uses the Max SUBSCRIPTION, never the paid API.
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;

  const proc = Bun.spawn(
    ["claude", "-p", userMessage, "--system-prompt", systemPrompt, "--model", model],
    { stdout: "pipe", stderr: "pipe", env: env as Record<string, string> },
  );

  // Abort (run cancelled / tab closed) → kill the spawned CLI immediately.
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
    // Drain stdout+stderr concurrently (no pipe backpressure), race against timeout.
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
    const answer = out.trim();
    if (!answer) throw new Error("claude CLI returned empty output");
    return answer;
  } catch (e) {
    proc.kill("SIGKILL"); // ensure no orphaned process on any error path
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

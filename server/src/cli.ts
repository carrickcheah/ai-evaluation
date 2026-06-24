/** CLI harness for backend phases (no UI needed).
 *   bun src/cli.ts projects                 — list projects
 *   bun src/cli.ts ask <project>            — ask the bot the FIRST dataset question
 *   bun src/cli.ts run <project> [--limit N] — run + grade the whole dataset
 */
import { listProjects, loadProject } from "./config";
import { askBot } from "./bot-runner";

async function main() {
  const [cmd, projectName, ...rest] = process.argv.slice(2);

  if (cmd === "projects") {
    console.log(listProjects().join("\n") || "(no projects found)");
    return;
  }

  if (cmd === "ask") {
    if (!projectName) throw new Error("usage: cli.ts ask <project>");
    const project = loadProject(projectName);
    if (!project.target) throw new Error(`Project "${project.name}" has no bot target (dataset-only)`);
    const first = project.dataset[0]!;
    console.log(`Project: ${project.name} | target: ${project.target.url}`);
    console.log(`Q: ${first.input}`);
    const answer = await askBot(project.target, first.input);
    console.log(`BOT: ${answer}`);
    return;
  }

  if (cmd === "run") {
    if (!projectName) throw new Error("usage: cli.ts run <project> [--limit N]");
    const limitFlag = rest.indexOf("--limit");
    const limit = limitFlag >= 0 ? Number(rest[limitFlag + 1]) : undefined;
    const { runEval } = await import("./run-eval");
    const { saveRun } = await import("./history");
    const project = loadProject(projectName);
    const cases = limit ? project.dataset.slice(0, limit) : project.dataset;
    const run = await runEval({ ...project, dataset: cases }, (done, total, last) => {
      const tag = last.error ? "ERR " : last.verdict.pass ? "PASS" : "FAIL";
      console.log(`[${done}/${total}] ${tag} ${last.input.slice(0, 50)}`);
    });
    saveRun(run);
    console.log(`\nSCORE ${run.score}%  (${run.passed} pass / ${run.failed} fail / ${run.errored} err)`);
    console.log(`saved run: ${run.id}`);
    return;
  }

  throw new Error(`unknown command: ${cmd ?? "(none)"} — try: projects | ask | run`);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

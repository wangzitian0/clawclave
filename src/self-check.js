import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { formatSelfCheckReport, runDailySelfCheck } from "./runtime.js";

function readJson(path, fallback = {}) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

function readArg(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function usage() {
  return `Usage: clawclave self-check [options]

Options:
  --root <path>             OpenClaw data root. Defaults to cwd.
  --openclaw-config <path>  OpenClaw config path. Defaults to <root>/openclaw.json.
  --force                   Run even when the interval has not elapsed.
  --no-delivery             Do not post the report to Discord.
  --json                    Print the full JSON report.
`;
}

export async function runCli(args = process.argv.slice(2), cwd = process.cwd()) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    return;
  }

  const root = resolve(cwd, readArg(args, "--root", "."));
  const openclawConfigPath = resolve(root, readArg(args, "--openclaw-config", "openclaw.json"));
  const openclawConfig = readJson(openclawConfigPath, {});
  const config = openclawConfig?.plugins?.entries?.clawclave?.config ?? {};
  const report = await runDailySelfCheck({
    root,
    config,
    openclawConfig,
    force: args.includes("--force"),
    deliverReport: !args.includes("--no-delivery")
  });

  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report?.skipped) {
    console.log(`Clawclave self-check skipped: ${report.reason}`);
  } else {
    console.log(formatSelfCheckReport(report));
  }

  if (report?.drift?.status === "ERROR") process.exitCode = 1;
}

/* c8 ignore next 6 */
if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

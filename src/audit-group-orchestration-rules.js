#!/usr/bin/env node
import { pathToFileURL } from "node:url";

export { auditGroupOrchestrationRules } from "./discussion-audits.js";
import { runGroupOrchestrationRulesCli } from "./discussion-audits.js";

export const runCli = runGroupOrchestrationRulesCli;

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}

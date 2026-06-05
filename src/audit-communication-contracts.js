#!/usr/bin/env node
import { pathToFileURL } from "node:url";

export { auditCommunicationContracts } from "./discussion-audits.js";
import { runCommunicationContractsCli } from "./discussion-audits.js";

export const runCli = runCommunicationContractsCli;

/* c8 ignore next 3 */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}

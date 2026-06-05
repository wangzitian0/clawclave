#!/usr/bin/env node
import { pathToFileURL } from "node:url";

export { auditDiscussionLifecycle } from "./discussion-audits.js";
import { runDiscussionLifecycleCli } from "./discussion-audits.js";

export const runCli = runDiscussionLifecycleCli;

/* c8 ignore next 3 */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}

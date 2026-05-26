import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import {
  appendHookTranscriptEvent,
  buildPromptHookDecision,
  recordOpenClawOutboundResult,
  recordOpenClawOutputIntent,
  resolvePluginConfig,
  resolveRootDir,
  startClawclaveMaintenance
} from "./src/runtime.js";

function warn(api, message, error) {
  const detail = error instanceof Error ? error.message : String(error);
  api.logger.warn?.(`clawclave: ${message}: ${detail}`);
}

function readConfig(event, api) {
  return resolvePluginConfig(event, api);
}

export default definePluginEntry({
  id: "clawclave",
  name: "Clawclave",
  description: "Discord group operations and onboarding for OpenClaw",
  register(api) {
    let stopMaintenance;

    function openclawConfig(event, ctx) {
      return ctx?.config ?? event?.config ?? api.config ?? {};
    }

    function stopWorkers() {
      if (typeof stopMaintenance === "function") stopMaintenance();
      stopMaintenance = undefined;
    }

    api.on(
      "gateway_start",
      async (event, ctx) => {
        try {
          stopWorkers();
          const config = readConfig(event, api);
          const root = resolveRootDir(api, config);
          stopMaintenance = startClawclaveMaintenance({
            root,
            config,
            openclawConfig: openclawConfig(event, ctx),
            logger: api.logger
          });
          api.logger.info?.("clawclave: maintenance workers started");
        } catch (error) {
          warn(api, "gateway_start maintenance skipped", error);
        }
      },
      { timeoutMs: 3000 }
    );

    api.on(
      "gateway_stop",
      async () => {
        stopWorkers();
      },
      { timeoutMs: 3000 }
    );

    api.on(
      "before_prompt_build",
      async (event, ctx) => {
        try {
          const config = readConfig(event, api);
          const root = resolveRootDir(api, config);
          const result = buildPromptHookDecision({ root, event, ctx, config });
          if (result.audit.loaded) {
            api.logger.debug?.(
              `clawclave: loaded ${result.audit.groupSlug ?? "unmapped"} via ${result.audit.resolvedBy}`
            );
          }
          return result.decision;
        } catch (error) {
          warn(api, "before_prompt_build skipped", error);
          return undefined;
        }
      },
      { timeoutMs: 3000 }
    );

    api.on(
      "message_received",
      async (event, ctx) => {
        try {
          const config = readConfig(event, api);
          const root = resolveRootDir(api, config);
          const result = appendHookTranscriptEvent({ root, event, ctx, config, direction: "inbound" });
          if (result.appended) api.logger.debug?.(`clawclave: recorded inbound event for ${result.groupSlug ?? "unmapped"}`);
        } catch (error) {
          warn(api, "message_received skipped", error);
        }
      },
      { timeoutMs: 3000 }
    );

    api.on(
      "message_sent",
      async (event, ctx) => {
        try {
          const config = readConfig(event, api);
          const root = resolveRootDir(api, config);
          const result = recordOpenClawOutboundResult({ root, event, ctx, config });
          if (result.recorded) api.logger.debug?.(`clawclave: recorded outbound event for ${result.groupSlug ?? "unmapped"}`);
        } catch (error) {
          warn(api, "message_sent skipped", error);
        }
      },
      { timeoutMs: 3000 }
    );

    api.on(
      "message_sending",
      async (event, ctx) => {
        try {
          const config = readConfig(event, api);
          const root = resolveRootDir(api, config);
          recordOpenClawOutputIntent({ root, event, ctx, config });
          return undefined;
        } catch (error) {
          warn(api, "message_sending skipped", error);
          return undefined;
        }
      },
      { timeoutMs: 3000 }
    );
  }
});

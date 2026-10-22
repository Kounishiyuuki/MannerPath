// Dispatch maintenance independently of canonical source checks. No cron is enabled here.
import type { Db } from "./db.ts";
import { scheduled as sourceScheduled, type RefreshEnv } from "./refresh/scheduled.ts";
import { runRetentionMaintenance } from "./reports/retention-automation.ts";
import { configuredPhotoStorage, type PhotoBindings, validRetentionCron } from "./reports/photo-policy.ts";

export interface MaintenanceEnv extends RefreshEnv, PhotoBindings {
  REPORTS_DB?: Db;
  REPORT_RETENTION?: string;
  REPORT_RETENTION_CRON?: string;
}
interface ScheduledDeps {
  now: () => Date;
  source: typeof sourceScheduled;
  log: (value: string) => void;
}
const defaults: ScheduledDeps = { now: () => new Date(), source: sourceScheduled, log: (value) => console.log(value) };

export async function dispatchScheduled(controller: ScheduledController, env: MaintenanceEnv, deps: ScheduledDeps = defaults): Promise<void> {
  const mode = env.REPORT_RETENTION ?? "off";
  const cron = env.REPORT_RETENTION_CRON;
  const validCron = validRetentionCron(cron);
  if (!["off", "monitor", "cleanup"].includes(mode) || ((cron !== undefined || mode !== "off") && !validCron)) {
    deps.log(JSON.stringify({ event: "reportRetention", outcome: "failed", reason: "configuration" }));
    throw new Error("Report retention maintenance failed");
  }
  if (cron !== undefined && controller.cron === cron) {
    if (mode === "off") {
      deps.log(JSON.stringify({ event: "reportRetention", outcome: "disabled" }));
      return;
    }
    if (!env.REPORTS_DB) {
      deps.log(JSON.stringify({ event: "reportRetention", outcome: "failed", reason: "storeUnavailable" }));
      throw new Error("Report retention maintenance failed");
    }
    const result = await runRetentionMaintenance(env.REPORTS_DB, {
      now: deps.now(), mode: mode as "monitor" | "cleanup", photoStorage: configuredPhotoStorage(env, deps.now),
    });
    deps.log(JSON.stringify(result));
    // Failure/unfinished work is visible in Cron invocation status as well as counts-only logs.
    if (result.outcome !== "complete") throw new Error("Report retention maintenance incomplete");
    return;
  }
  await deps.source(controller, env);
}

export const scheduled = (controller: ScheduledController, env: MaintenanceEnv): Promise<void> => dispatchScheduled(controller, env);

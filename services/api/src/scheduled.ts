// Dispatch maintenance independently of canonical source checks. No cron is enabled here.
import type { Db } from "./db.ts";
import { scheduled as sourceScheduled, type RefreshEnv } from "./refresh/scheduled.ts";
import { runRetentionMaintenance } from "./reports/retention-automation.ts";
import { configuredPhotoStorage, PHOTO_RETENTION_CRON, type PhotoBindings, validRetentionCron } from "./reports/photo-policy.ts";

/** The v1.0 retention schedule (scripts/production-v1-plan.ts). Reserved, like the photo one, for retention only. */
export const V1_RETENTION_CRON = "2-57/5 * * * *";
const RETENTION_CRONS: readonly string[] = [V1_RETENTION_CRON, PHOTO_RETENTION_CRON];
/** Schedules allowed to reach source checks (docs/OPERATIONS.md). Any other unmatched event fails closed. */
export const SOURCE_CHECK_CRONS: readonly string[] = ["0 18 * * *"];

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
  // A reserved retention schedule that does not match the configured mapping (an old version without
  // REPORT_RETENTION_CRON still receiving the trigger, a typo) must never fall into source checks, R2 or DB writes.
  if (RETENTION_CRONS.includes(controller.cron) || !SOURCE_CHECK_CRONS.includes(controller.cron)) {
    deps.log(JSON.stringify({ event: "scheduled", outcome: "failed", reason: "unexpectedCron" }));
    throw new Error("Scheduled event matches no configured handler");
  }
  await deps.source(controller, env);
}

export const scheduled = (controller: ScheduledController, env: MaintenanceEnv): Promise<void> => dispatchScheduled(controller, env);

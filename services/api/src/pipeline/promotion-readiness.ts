import { z } from "zod";
import type { Db } from "../db.ts";

export const PromotionReadinessV1 = z.object({
  schemaVersion: z.literal(1),
  completed: z.boolean(),
  state: z.enum(["completed", "promotionIncomplete", "localPipeline"]),
});

/** Read only DATA_DB. A legacy completion cannot make an unfinished segmented GREEN ready. */
export async function promotionReadiness(db: Db): Promise<z.infer<typeof PromotionReadinessV1>> {
  const v4 = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'promotion_v4_manifests'").first();
  const state = await db.prepare(`SELECT
    EXISTS(SELECT 1 FROM promotion_bootstraps) OR EXISTS(SELECT 1 FROM promotion_multi_bootstraps) AS started,
    EXISTS(SELECT 1 FROM promotion_bootstrap_completions) OR EXISTS(SELECT 1 FROM promotion_multi_bootstrap_completions) AS completed
    ${v4 === null ? "" : `, EXISTS(SELECT 1 FROM promotion_v4_manifests) AS segmented,
    NOT EXISTS(SELECT 1 FROM promotion_v4_manifests m WHERE NOT EXISTS
      (SELECT 1 FROM promotion_v4_completions c WHERE c.id = m.id AND c.manifest_sha256 = m.manifest_sha256)) AS segmented_complete`}
  `).first<{ started: number; completed: number; segmented?: number; segmented_complete?: number }>();
  const completed = state?.completed === 1 && state.segmented_complete !== 0;
  return PromotionReadinessV1.parse({ schemaVersion: 1, completed,
    state: completed ? "completed" : state?.started === 1 || state?.segmented === 1 ? "promotionIncomplete" : "localPipeline" });
}

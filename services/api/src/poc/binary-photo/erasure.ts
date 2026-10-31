// PoC — erasure lead for the D1 photo store. D1 Time Travel keeps 7 days of restorable history (Workers Free), so a
// photo's bytes are only gone from every D1-held copy 7 days after its fence. To keep that inside the 90-day ceiling,
// erasure starts 9 days early: 7 (Time Travel) + 1 (a D1 daily-limit outage blocks every query until 00:00 UTC)
// + 1 (retries). This step only moves due photos into the existing deletion queue (ready/uploading → deleting, whose
// trigger queues the key); cleanupEvidencePhotos then fences them exactly as today.
import { type Db, isoSeconds } from "../../db.ts";

export const D1_TIME_TRAVEL_DAYS = 7;
export const D1_PHOTO_ERASURE_LEAD_DAYS = D1_TIME_TRAVEL_DAYS + 1 + 1;

export async function queueDuePhotosForErasure(db: Db, now: Date, leadDays = D1_PHOTO_ERASURE_LEAD_DAYS): Promise<number> {
  if (!Number.isInteger(leadDays) || leadDays < D1_TIME_TRAVEL_DAYS + 1) throw new Error(`erasure lead must exceed Time Travel, got ${leadDays}`);
  const result = await db.prepare(`UPDATE community_evidence_photos SET lifecycle = 'deleting'
      WHERE lifecycle IN ('ready', 'uploading') AND julianday(delete_after) <= julianday(?, '+${leadDays} days')`)
    .bind(isoSeconds(now)).run() as { meta?: { changes?: number }; changes?: number | bigint };
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

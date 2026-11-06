// ADR-0021 §10: read-only table-level inventory, never an approval/apply/ownership oracle.
import { type Db, isoSeconds } from "../db.ts";
import { REPORT_STORE_SCHEMA } from "./evidence-artifact.ts";

export const REPORT_DATA_GROUPS = {
  reports: ["reports"],
  authentication: ["app_attest_keys", "app_attest_key_revocations", "app_attest_challenges"],
  rateLimits: ["report_rate_windows"],
  idempotency: ["report_idempotency"],
  moderation: ["report_moderation"],
  reviewEvidence: ["report_reviews", "report_review_evidence", "new_spot_evidence_checks"],
  audit: ["admin_review_audit", "report_bulk_rejections", "report_bulk_rejection_targets", "report_bulk_rejection_completions"],
  photosDisabled: ["community_evidence_photos", "community_photo_requests", "community_photo_deletions", "community_photo_deletion_attempts"],
  metadata: ["report_store_meta", "report_terms_documents", "moderation_queue_revision", "report_bulk_store_identity"],
} as const;

async function total(db: Db, sql: string, binds: string[] = []): Promise<number> {
  const row = await db.prepare(sql).bind(...binds).first<{ n: number }>();
  if (!row || !Number.isSafeInteger(row.n) || row.n < 0) throw new Error("Inventory unavailable");
  return row.n;
}

export async function reportPrivacyInventory(db: Db, now: Date) {
  if (!Number.isFinite(now.getTime())) throw new Error("Inventory unavailable");
  const identity = await db.prepare("SELECT (SELECT value FROM report_store_meta WHERE key='store') AS store, (SELECT value FROM report_store_meta WHERE key='schema') AS schema").first<{ store: string; schema: string }>();
  if (identity?.store !== "mannerpath-reports" || identity.schema !== REPORT_STORE_SCHEMA) throw new Error("Inventory unavailable");
  const names = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all<{ name: string }>();
  const known = new Set<string>(Object.values(REPORT_DATA_GROUPS).flat());
  // Exact engine-owned bookkeeping names observed in local D1. Never ignore an arbitrary prefix.
  const engineMetadata = new Set(["d1_migrations", "_cf_METADATA"]);
  const unreviewedTables = names.results.filter(r => !known.has(r.name) && !engineMetadata.has(r.name)).length;
  const groups: Record<string, Record<string, number>> = {};
  for (const [group, tables] of Object.entries(REPORT_DATA_GROUPS)) {
    groups[group] = {};
    // Table identifiers come only from the reviewed constants, never from the input or sqlite_master.
    for (const table of tables) groups[group][table] = await total(db, `SELECT count(*) AS n FROM ${table}`);
  }
  const at = isoSeconds(now);
  return {
    event: "reportPrivacyInventory" as const,
    coverage: unreviewedTables ? "unreviewed-tables" : "reviewed-table-set",
    unreviewedTables,
    groups,
    reportStatus: {
      notMinimized: await total(db, "SELECT count(*) AS n FROM reports WHERE redacted_at IS NULL"),
      dueForMinimization: await total(db, "SELECT count(*) AS n FROM reports WHERE redacted_at IS NULL AND minimize_after <= ?", [at]),
      minimizedSkeletons: await total(db, "SELECT count(*) AS n FROM reports WHERE redacted_at IS NOT NULL"),
    },
    outsideScope: { engineManagedMetadata: "not-inspected", dataDbArtifacts: "not-inspected", providerLogs: "not-inspected", supportMailbox: "not-inspected", backups: "not-inspected" },
    snapshot: "non-atomic-read-only", // never a write permission or proof of no concurrent changes
    ownershipVerified: false,
    publicationReady: false,
    writesPerformed: false,
  };
}

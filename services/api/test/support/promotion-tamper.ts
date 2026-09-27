// An attacker's edit of a promotion bundle that keeps the file consistent with itself: the body is
// changed and the header's contentSha256 recomputed (Issue #100, docs/OPERATIONS.md step 4).
import { sha256Hex } from "../../src/db.ts";

export async function rehashed(sql: string, edit: (body: string) => string): Promise<string> {
  const start = sql.indexOf("\n-- promotion_bootstraps: refused unless the target is empty\n") + 1;
  if (start === 0) throw new Error("rehashed: no bundle body start in the given SQL");
  const body = edit(sql.slice(start));
  const header = sql.slice(0, start).replace(/^-- contentSha256: [0-9a-f]{64}$/m, `-- contentSha256: ${await sha256Hex(body)}`);
  return header + body;
}

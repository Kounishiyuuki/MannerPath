import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { checkArguments } from "../scripts/retention-rehearsal.ts";

test("disposable retention rehearsal has no remote, target, config or persistent-store options", () => {
  assert.doesNotThrow(() => checkArguments([]));
  for (const args of [["--remote"], ["--config", "wrangler.jsonc"], ["--persist-to", "/tmp/existing"], ["--env", "production"]]) {
    assert.throws(() => checkArguments(args), /No arguments allowed/);
    const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/retention-rehearsal.ts", ...args],
      { cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 30_000 });
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /retention rehearsal failed \(local only\)/);
    assert.doesNotMatch(r.stderr, /wrangler d1|production|SQLITE|credential/);
  }
});

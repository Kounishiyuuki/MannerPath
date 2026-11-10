#!/usr/bin/env python3
"""Validate checkout claims with disposable Git repos, never GitHub or credentials."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


CHECKER = Path(__file__).with_name("check-validation-checkout.py").resolve()
PRIVATE_NAME = "operator-private-filename.txt"
PRIVATE_CONTENT = "fixture-private-row-must-not-be-emitted"
PRIVATE_EVENT = "fixture-event-body-must-not-be-emitted"


class ValidationCheckoutTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="validation checkout test ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.event = self.root / "private-event.json"
        self.env = dict(os.environ)
        for key in list(self.env):
            if key.startswith(("GITHUB_", "GIT_")):
                self.env.pop(key)
        self.env.update(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1",
                        GIT_TERMINAL_PROMPT="0")
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Checkout Test")
        self.git("config", "user.email", "checkout-test@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.git("config", "core.hooksPath", str(self.root / "no-hooks"))
        self.git("config", "core.autocrlf", "false")
        (self.repo / ".gitignore").write_text("generated/\n")
        (self.repo / PRIVATE_NAME).write_text("baseline\n")
        (self.repo / "services/api").mkdir(parents=True)
        (self.repo / "services/api/fixture.txt").write_text("baseline\n")
        self.git("add", ".")
        self.git("commit", "-qm", "initial test fixture")
        self.initial = self.git("rev-parse", "HEAD")

    def git(self, *args, input=None):
        return subprocess.run(["git", *args], cwd=self.repo, env=self.env, input=input,
                              capture_output=True, text=True, check=True).stdout.strip()

    def check(self, *args, cwd=None, env=None):
        return subprocess.run([sys.executable, str(CHECKER), *args], cwd=cwd or self.repo,
                              env=env or self.env, capture_output=True, text=True, timeout=5)

    def ci(self, event_name, payload, sha=None, omit=(), raw=False):
        self.event.write_text(payload if raw else json.dumps(payload))
        env = dict(self.env, GITHUB_SHA=sha or self.git("rev-parse", "HEAD"),
                   GITHUB_EVENT_NAME=event_name, GITHUB_EVENT_PATH=str(self.event))
        for key in omit:
            env.pop(key, None)
        return self.check("--ci", env=env)

    def assert_private(self, result):
        output = result.stdout + result.stderr
        for private in (PRIVATE_NAME, PRIVATE_CONTENT, PRIVATE_EVENT, str(self.event)):
            self.assertNotIn(private, output)
        self.assertNotIn("Traceback", output)

    def assert_verified(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertTrue(report["checkoutVerified"])
        self.assertTrue(report["clean"])
        self.assertEqual(report["checkoutCommit"], report["expectedCommit"])
        self.assertNotIn("success", result.stdout.lower())
        self.assertNotIn("test", result.stdout.lower())
        self.assert_private(result)
        return report

    def test_clean_explicit_local_commit_is_checkout_identity_only(self):
        report = self.assert_verified(self.check("--commit", self.initial))
        self.assertEqual(report["checkoutCommit"], self.initial)
        self.assertEqual(report["tree"], self.git("rev-parse", "HEAD^{tree}"))
        self.assertIsNone(report["prHeadCommit"])

    def test_wrong_and_stale_reviewed_commits_are_refused(self):
        (self.repo / "services/api/fixture.txt").write_text("new committed version\n")
        self.git("add", ".")
        self.git("commit", "-qm", "new test revision")
        for expected in (self.initial, "0" * 40):
            with self.subTest(expected=expected):
                result = self.check("--commit", expected)
                self.assertEqual(result.returncode, 1)
                report = json.loads(result.stdout)
                self.assertFalse(report["checkoutVerified"])
                self.assertTrue(report["clean"])
                self.assert_private(result)

    def test_dirty_changes_are_refused_for_root_and_subdirectory_callers(self):
        for directory in (self.repo, self.repo / "services/api"):
            for state in ("unstaged", "staged", "untracked"):
                with self.subTest(cwd=directory.name, state=state):
                    self.git("reset", "--hard", "-q", "HEAD")
                    self.git("clean", "-fdq")
                    path = self.repo / (PRIVATE_NAME if state != "untracked" else "untracked-" + PRIVATE_NAME)
                    path.write_text(PRIVATE_CONTENT)
                    if state == "staged":
                        self.git("add", "--", str(path))
                    result = self.check("--commit", self.initial, cwd=directory)
                    self.assertEqual(result.returncode, 1)
                    report = json.loads(result.stdout)
                    self.assertFalse(report["checkoutVerified"])
                    self.assertFalse(report["clean"])
                    self.assert_private(result)

    def test_ignored_generated_files_do_not_make_the_git_checkout_dirty(self):
        generated = self.repo / "generated"
        generated.mkdir()
        (generated / PRIVATE_NAME).write_text(PRIVATE_CONTENT)
        self.assert_verified(self.check("--commit", self.initial, cwd=self.repo / "services/api"))

    def test_repository_ignore_allows_bytecode_but_not_untracked_python_sources(self):
        (self.repo / ".gitignore").write_text((CHECKER.parent.parent / ".gitignore").read_text())
        self.git("add", ".gitignore")
        self.git("commit", "-qm", "repository generated-output policy")
        reviewed = self.git("rev-parse", "HEAD")
        cache = self.repo / "scripts/__pycache__"
        cache.mkdir(parents=True)
        (cache / "fixture.cpython-313.pyc").write_bytes(b"generated fixture")
        self.assert_verified(self.check("--commit", reviewed))
        (cache.parent / "untracked-source.py").write_text(PRIVATE_CONTENT)
        result = self.check("--commit", reviewed)
        self.assertEqual(result.returncode, 1)
        self.assertFalse(json.loads(result.stdout)["clean"])
        self.assert_private(result)

    def make_pr_merge(self):
        self.git("checkout", "-qb", "feature")
        (self.repo / "feature.txt").write_text("feature fixture\n")
        self.git("add", ".")
        self.git("commit", "-qm", "PR head fixture")
        head = self.git("rev-parse", "HEAD")
        self.git("checkout", "-q", "main")
        (self.repo / "base.txt").write_text("base fixture\n")
        self.git("add", ".")
        self.git("commit", "-qm", "base fixture")
        self.git("merge", "--no-ff", "-qm", "synthetic PR merge", "feature")
        return head, self.git("rev-parse", "HEAD")

    def test_ci_pull_request_verifies_merge_sha_and_separate_included_pr_head(self):
        head, merge = self.make_pr_merge()
        self.assertNotEqual(head, merge)
        payload = {"pull_request": {"head": {"sha": head}, "merge_commit_sha": merge},
                   "private_fixture": PRIVATE_EVENT}
        report = self.assert_verified(self.ci("pull_request", payload, sha=merge))
        self.assertEqual(report["prHeadCommit"], head)
        self.assertEqual(report["expectedCommit"], merge)
        self.assertTrue(report["includesPrHead"])
        wrong = self.ci("pull_request", payload, sha=head)
        self.assertEqual(wrong.returncode, 1)
        self.assertFalse(json.loads(wrong.stdout)["checkoutVerified"])
        self.assert_private(wrong)

    def test_ci_pull_request_rejects_unrelated_head_even_with_matching_checkout_sha(self):
        tree = self.git("rev-parse", "HEAD^{tree}")
        unrelated = self.git("commit-tree", tree, input="unrelated orphan fixture\n")
        result = self.ci("pull_request", {"pull_request": {"head": {"sha": unrelated}},
                                          "private_fixture": PRIVATE_EVENT})
        self.assertEqual(result.returncode, 1)
        report = json.loads(result.stdout)
        self.assertFalse(report["checkoutVerified"])
        self.assertFalse(report["includesPrHead"])
        self.assert_private(result)

    def test_ci_push_requires_event_after_to_match_event_sha(self):
        payload = {"after": self.initial, "private_fixture": PRIVATE_EVENT}
        self.assert_verified(self.ci("push", payload))
        for after in ("0" * 40, None):
            with self.subTest(after=after):
                result = self.ci("push", {"after": after, "private_fixture": PRIVATE_EVENT})
                self.assertEqual(result.returncode, 1)
                self.assert_private(result)

    def test_ci_missing_metadata_is_refused_without_echoing_payload_or_path(self):
        payload = {"pull_request": {"head": {"sha": self.initial}}, "private_fixture": PRIVATE_EVENT}
        for missing in ("GITHUB_SHA", "GITHUB_EVENT_NAME", "GITHUB_EVENT_PATH"):
            with self.subTest(missing=missing):
                result = self.ci("pull_request", payload, omit=(missing,))
                self.assertEqual(result.returncode, 1)
                self.assert_private(result)
        for payload in ({}, {"pull_request": {}}, {"pull_request": {"head": {"sha": None}}}):
            with self.subTest(payload=payload):
                result = self.ci("pull_request", payload)
                self.assertEqual(result.returncode, 1)
                self.assert_private(result)

    def test_ci_invalid_event_json_and_types_fail_closed_without_tracebacks(self):
        for event, payload, raw in (("pull_request", PRIVATE_EVENT, True),
                                    ("pull_request", [], False),
                                    ("push", [PRIVATE_EVENT], False),
                                    ("workflow_dispatch", {"private_fixture": PRIVATE_EVENT}, False)):
            with self.subTest(event=event, payload=payload):
                result = self.ci(event, payload, raw=raw)
                self.assertEqual(result.returncode, 1)
                self.assert_private(result)

    def test_invalid_local_commit_and_non_git_directory_have_redacted_failures(self):
        for expected in ("short", "A" * 40, "1" * 41):
            with self.subTest(expected=expected):
                result = self.check("--commit", expected)
                self.assertEqual(result.returncode, 1)
                self.assert_private(result)
        result = self.check("--commit", self.initial, cwd=self.root)
        self.assertEqual(result.returncode, 1)
        self.assert_private(result)


if __name__ == "__main__":
    unittest.main()

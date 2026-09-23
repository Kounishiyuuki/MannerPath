#!/usr/bin/env python3
"""Inspect an iPhone .app or .xcarchive before the physical beta matrix."""
import argparse
import ipaddress
import pathlib
import plistlib
import re
import subprocess
import sys
from urllib.parse import urlparse

GROUP = "group.com.kounishiyuuki.MannerPath"
IDS = {
    "iPhone app": "com.kounishiyuuki.MannerPath",
    "iPhone widget": "com.kounishiyuuki.MannerPath.widgets",
    "Watch app": "com.kounishiyuuki.MannerPath.watchkitapp",
    "Watch widget": "com.kounishiyuuki.MannerPath.watchkitapp.widgets",
}
ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE_ENTITLEMENTS = {
    "iPhone app": ROOT / "apps/apple/MannerPath/MannerPath.entitlements",
    "iPhone widget": ROOT / "apps/apple/MannerPath/MannerPathWidgets/MannerPathWidgets.entitlements",
    "Watch app": ROOT / "apps/apple/MannerPath/MannerPathWatch Watch App/MannerPathWatch.entitlements",
    "Watch widget": ROOT / "apps/apple/MannerPath/MannerPathWatchWidgets/MannerPathWatchWidgets.entitlements",
}


def fail(message):
    raise ValueError(message)


def plist(path):
    try:
        with path.open("rb") as stream:
            return plistlib.load(stream)
    except (OSError, plistlib.InvalidFileException) as error:
        fail(f"{path}: missing or invalid plist ({error})")


def signed_entitlements(bundle):
    verified = subprocess.run(["codesign", "--verify", "--strict", str(bundle)],
                              capture_output=True)
    if verified.returncode:
        fail(f"{bundle}: code signature verification failed; rebuild and sign the beta artifact")
    result = subprocess.run(["codesign", "-d", "--entitlements", ":-", str(bundle)],
                            capture_output=True)
    if result.returncode:
        fail(f"{bundle}: no readable code signature; inspect a signed device/archive artifact or use --unsigned-build")
    try:
        return plistlib.loads(result.stdout)
    except plistlib.InvalidFileException:
        fail(f"{bundle}: code signature has no readable entitlements")


def check_provisioning(bundle, identifier, entitlements):
    profile_path = bundle / "embedded.mobileprovision"
    if not profile_path.is_file():
        fail(f"{bundle}: embedded.mobileprovision missing; use a provisioned device/archive build")
    result = subprocess.run(["security", "cms", "-D", "-i", str(profile_path)],
                            capture_output=True)
    if result.returncode:
        fail(f"{bundle}: embedded provisioning profile cannot be decoded")
    try:
        profile = plistlib.loads(result.stdout)
    except plistlib.InvalidFileException:
        fail(f"{bundle}: embedded provisioning profile is not a plist")
    teams = profile.get("TeamIdentifier")
    if not isinstance(teams, list) or len(teams) != 1:
        fail(f"{bundle}: provisioning profile must have exactly one TeamIdentifier")
    team = teams[0]
    expected_app_id = f"{team}.{identifier}"
    profile_ent = profile.get("Entitlements", {})
    for name, actual, expected in (
        ("signed team identifier", entitlements.get("com.apple.developer.team-identifier"), team),
        ("signed application identifier", entitlements.get("application-identifier"), expected_app_id),
        ("profile application identifier", profile_ent.get("application-identifier"), expected_app_id),
        ("profile App Group", profile_ent.get("com.apple.security.application-groups"), [GROUP]),
    ):
        if actual != expected:
            fail(f"{bundle}: {name} does not match the expected bundle, team, or App Group")
    if "com.apple.developer.devicecheck.appattest-environment" in profile_ent:
        if profile_ent["com.apple.developer.devicecheck.appattest-environment"] != entitlements.get("com.apple.developer.devicecheck.appattest-environment"):
            fail(f"{bundle}: profile and signed App Attest environments differ")


def one(parent, pattern, label):
    matches = list(parent.glob(pattern))
    if len(matches) != 1:
        fail(f"{label}: expected exactly one embedded bundle at {parent / pattern}; found {len(matches)}")
    return matches[0]


def valid_host(host):
    if ":" in host:
        try:
            ipaddress.IPv6Address(host)
            return True
        except ValueError:
            return False
    labels = host.rstrip(".").split(".")
    return bool(labels) and all(re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label) for label in labels)


def inspect(path, unsigned):
    if path.suffix == ".xcarchive":
        app = one(path / "Products/Applications", "MannerPath.app", "iPhone app")
    else:
        app = path
    if not app.is_dir() or app.suffix != ".app":
        fail(f"{app}: supply MannerPath.app or an .xcarchive")
    iphone_widget = one(app / "PlugIns", "MannerPathWidgets.appex", "iPhone widget")
    watch = one(app / "Watch", "*.app", "Watch app")
    watch_widget = one(watch / "PlugIns", "MannerPathWatchWidgets.appex", "Watch widget")
    bundles = dict(zip(IDS, (app, iphone_widget, watch, watch_widget)))
    infos = {}
    for label, bundle in bundles.items():
        info = plist(bundle / "Info.plist")
        infos[label] = info
        actual = info.get("CFBundleIdentifier")
        if actual != IDS[label]:
            fail(f"{label}: CFBundleIdentifier {actual!r}; expected {IDS[label]!r}")
        if not unsigned:
            platform = info.get("DTPlatformName")
            expected_platform = "iphoneos" if label.startswith("iPhone") else "watchos"
            if platform != expected_platform:
                fail(f"{label}: platform {platform!r}; expected {expected_platform!r} for signed device evidence")
        ent = plist(SOURCE_ENTITLEMENTS[label]) if unsigned else signed_entitlements(bundle)
        groups = ent.get("com.apple.security.application-groups")
        if groups != [GROUP]:
            fail(f"{label}: application-groups {groups!r}; expected [{GROUP!r}]")
        if not unsigned:
            check_provisioning(bundle, IDS[label], ent)
        if label == "iPhone app":
            environment = ent.get("com.apple.developer.devicecheck.appattest-environment")
            if environment not in ("development", "production"):
                fail(f"iPhone app: App Attest environment {environment!r}; expected development or production")
        print(f"{label}: {actual} | App Group: {GROUP}")
    origin = infos["iPhone app"].get("MannerPathAPIBaseURL")
    try:
        parsed = urlparse(origin) if isinstance(origin, str) else None
        valid_authority = bool(parsed and parsed.hostname and parsed.port != 0
                               and not parsed.netloc.endswith(":")
                               and not any(char.isspace() or char == "\\" for char in origin)
                               and not any(char.isspace() or char in "\\%" for char in parsed.netloc)
                               and valid_host(parsed.hostname))
    except ValueError:
        valid_authority = False
    if not valid_authority or parsed.scheme != "https" or parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        fail("iPhone app: MannerPathAPIBaseURL is missing or invalid; set an HTTPS API origin for the beta build")
    version = infos["iPhone app"].get("CFBundleVersion")
    if not version:
        fail("iPhone app: CFBundleVersion missing; App Attest server allowlisting needs it")
    print(f"MannerPathAPIBaseURL: {origin}")
    print(f"CFBundleVersion for App Attest server: {version}")
    print(f"App Attest declared entitlement: {environment} ({'source file only' if unsigned else 'signed artifact'}; TestFlight uses production)")
    print("Embedding: iPhone widget, Watch app, Watch widget present")
    print("Evidence: UNSIGNED BUILD + source entitlements; no signing/device proof" if unsigned else
          "Evidence: signed artifact entitlements and bundle structure; physical-device behavior still unverified")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact", type=pathlib.Path, help="MannerPath.app or .xcarchive")
    parser.add_argument("--unsigned-build", action="store_true", help="Use source entitlements; never claim signing proof")
    args = parser.parse_args()
    try:
        inspect(args.artifact, args.unsigned_build)
    except ValueError as error:
        print(f"FAIL: {error}", file=sys.stderr)
        sys.exit(1)

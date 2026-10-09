#!/usr/bin/env python3
"""Inspect an iPhone .app or .xcarchive before the physical beta matrix."""
import argparse
import importlib.util
import ipaddress
import json
import pathlib
import plistlib
import re
import subprocess
import sys
from urllib.parse import urlparse

# Shared value detector; release correctness remains owned by this checker.
_spec = importlib.util.spec_from_file_location("release_secret_scan", pathlib.Path(__file__).with_name("security-secret-scan.py"))
_secret_scan = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_secret_scan)

GROUP = "group.com.kounishiyuuki.MannerPath"
PRODUCTION_API = "https://mannerpath-api-production.happywestyuki.workers.dev"
PUBLIC_SITE = "https://kounishiyuuki.github.io/MannerPath/"
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


def check_icon(bundle, info, label):
    icons = info.get("CFBundleIcons")
    primary = icons.get("CFBundlePrimaryIcon") if isinstance(icons, dict) else None
    if not isinstance(primary, dict) or primary.get("CFBundleIconName") != "AppIcon":
        fail(f"{label}: CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconName must be AppIcon")
    assets = bundle / "Assets.car"
    if not assets.is_file():
        fail(f"{label}: Assets.car missing")
    try:
        result = subprocess.run(["xcrun", "assetutil", "--info", str(assets)],
                                capture_output=True)
    except OSError:
        fail(f"{label}: assetutil unavailable; install/select Xcode to verify AppIcon")
    if result.returncode:
        fail(f"{label}: assetutil could not inspect Assets.car")
    try:
        renditions = json.loads(result.stdout)
    except (ValueError, UnicodeDecodeError):
        fail(f"{label}: invalid assetutil output")
    if not isinstance(renditions, list) or not any(
        isinstance(item, dict) and item.get("Name") == "AppIcon"
        and item.get("PixelWidth") == 1024 and item.get("PixelHeight") == 1024
        for item in renditions
    ):
        fail(f"{label}: AppIcon 1024x1024 rendition missing")
    print(f"{label}: AppIcon metadata, Assets.car and 1024x1024 rendition verified")


# Normalised (lowercase, separators removed) fragments that mark a key or build setting as credential-like.
SECRET_KEY = re.compile(r"apikey|accesskey|privatekey|clientsecret|secret|token|password|passwd|credential|bearer|"
                        r"authorization|pepper")
# Public values whose names are allowed even if a future fragment would match them.
PUBLIC_KEYS = {"MannerPathAPIBaseURL", "MannerPathPublicSiteURL", "CFBundleIdentifier",
               "MANNERPATH_API_BASE_URL", "MANNERPATH_PUBLIC_SITE_URL", "PRODUCT_BUNDLE_IDENTIFIER"}
# Any URL embedded in a plist string, not only whole-value URLs.
URL_IN_TEXT = re.compile(r"(?i)\b[a-z][a-z0-9+.-]*://[^\s\"'<>]*")
WEB_SCHEMES = {"http", "https", "ws", "wss", "ftp"}
# Present only in #if DEBUG UI-test hooks (WatchNearbyModel / MannerPathWatchApp); a Release binary must not carry them.
DEBUG_MARKERS = (b"--mannerpath-watch-ui-test", b"MANNERPATH_WATCH_UI_TEST")
LOCATION_ALWAYS = ("NSLocationAlwaysUsageDescription", "NSLocationAlwaysAndWhenInUseUsageDescription")
PROJECT = ROOT / "apps/apple/MannerPath/MannerPath.xcodeproj/project.pbxproj"


def secretish(name):
    return name not in PUBLIC_KEYS and bool(SECRET_KEY.search(re.sub(r"[^a-z0-9]", "", name.lower())))


def plist_items(value, path=""):
    """Yields (dotted key path, leaf key, value) for every node of nested dicts/arrays."""
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}" if path else str(key)
            yield child_path, str(key), child
            yield from plist_items(child, child_path)
    elif isinstance(value, list):
        leaf = path.rsplit(".", 1)[-1]
        for index, child in enumerate(value):
            yield f"{path}[{index}]", leaf, child
            yield from plist_items(child, f"{path}[{index}]")


def numeric_host(host):
    # inet_aton also accepts 127.1, 2130706433 and 0x7f.0.0.1; treat any all-numeric host as an IP literal.
    return all(re.fullmatch(r"(?i)0x[0-9a-f]*|[0-9]+", label) for label in host.rstrip(".").split("."))


def release_url_problem(value):
    """Reason a URL may not ship in a Release bundle, or None. Never includes the value itself."""
    try:
        parsed = urlparse(value)
        host = parsed.hostname
        parsed.port
    except ValueError:
        return "is not a parseable URL"
    if parsed.scheme.lower() not in WEB_SCHEMES:
        return None
    if parsed.scheme.lower() != "https":
        return "is not HTTPS"
    if not host:
        return "has no host"
    if parsed.username or parsed.password:
        return "carries credentials"
    host = host.rstrip(".").lower()
    if host == "localhost" or host.endswith(".localhost"):
        return "names localhost"
    try:
        address = ipaddress.ip_address(host.split("%")[0])
    except ValueError:
        if numeric_host(host):
            return "uses a numeric IP host"
        return None
    mapped = getattr(address, "ipv4_mapped", None)
    if address.is_loopback or (mapped and mapped.is_loopback):
        return "is loopback"
    # Release origins are DNS names; a private, link-local or public IP literal is a test endpoint until reviewed.
    return "uses an IP literal host"


def check_info_hygiene(info, label):
    for path, key, value in plist_items(info):
        if secretish(key):
            fail(f"{label}: Info.plist key {path!r} looks like a secret; secrets never ship in the bundle")
        for url in URL_IN_TEXT.findall(value) if isinstance(value, str) else ():
            problem = release_url_problem(url)
            if problem:
                fail(f"{label}: Info.plist {path!r} {problem}; Release must use production HTTPS only")
        if key == "MannerPathAPIBaseURL" and value != PRODUCTION_API:
            fail(f"{label}: Info.plist {path!r} must equal the canonical production Release origin")
        if key == "MannerPathPublicSiteURL" and value != PUBLIC_SITE:
            fail(f"{label}: Info.plist {path!r} must equal the canonical production public site")


def check_location_keys(info, label):
    for key in LOCATION_ALWAYS:
        if key in info:
            fail(f"{label}: {key}: Always location authorization is not allowed (apps/apple/AGENTS.md)")
    if label in ("iPhone app", "Watch app"):
        if not info.get("NSLocationWhenInUseUsageDescription"):
            fail(f"{label}: NSLocationWhenInUseUsageDescription missing")
    else:
        # Widgets and other extensions read the App Group snapshot; they never ask for location.
        extra = sorted(key for key in info if key.startswith("NSLocation") or key == "NSWidgetWantsLocation")
        if extra:
            fail(f"{label}: location permission key {extra[0]!r} is not needed in this bundle")


def check_release_binary(bundle, info, label):
    executable = info.get("CFBundleExecutable")
    if not executable or not (bundle / executable).is_file():
        fail(f"{label}: CFBundleExecutable missing from the bundle")
    # Debug builds move the code into <executable>.debug.dylib and add __preview.dylib (Xcode previews).
    debug_dylibs = [path.name for path in bundle.glob("*.dylib")
                    if path.name.endswith(".debug.dylib") or path.name == "__preview.dylib"]
    if debug_dylibs:
        fail(f"{label}: Debug/preview dylib {debug_dylibs[0]!r} in bundle; build with -configuration Release")
    for binary in [bundle / executable, *bundle.glob("*.dylib")]:
        data = binary.read_bytes()
        for marker in DEBUG_MARKERS:
            if marker in data:
                fail(f"{label}: {binary.name} contains Debug-only UI-test hook {marker.decode()!r}; build with -configuration Release")


def embedded_bundles(app):
    """Every .app/.appex inside the iPhone app, at any depth, in a stable order."""
    return sorted(path for path in app.rglob("*") if path.suffix in (".app", ".appex") and path.is_dir())


def check_build_settings(project=PROJECT):
    """All targets and configurations: no credential-like setting; Release origins are the canonical ones."""
    try:
        with subprocess.Popen(["plutil", "-convert", "json", "-o", "-", str(project)],
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as process:
            output = process.stdout.read()
        if process.returncode:
            raise ValueError("plutil failed")
        data = json.loads(output)
    except (OSError, ValueError):
        fail(f"{project}: cannot parse project build settings")
    if not isinstance(data, dict):
        fail(f"{project}: cannot parse project build settings")
    release_origins = []
    for item in data.get("objects", {}).values():
        if item.get("isa") != "XCBuildConfiguration":
            continue
        settings = item.get("buildSettings", {})
        for name, value in settings.items():
            if _secret_scan.secret_types(json.dumps(value).encode()):
                fail(f"build settings ({item.get('name')}): {name!r} contains a secret-looking literal; keep secrets out of the app project")
            if secretish(name):
                fail(f"build settings ({item.get('name')}): {name!r} looks like a secret; keep secrets out of the app project")
        if item.get("name") == "Release":
            # The value may be a string or, after plutil conversion, a list.
            if re.search(r"\bDEBUG\b", str(settings.get("SWIFT_ACTIVE_COMPILATION_CONDITIONS", ""))):
                fail("build settings (Release): SWIFT_ACTIVE_COMPILATION_CONDITIONS contains DEBUG")
            if "MANNERPATH_API_BASE_URL" in settings:
                release_origins.append((settings["MANNERPATH_API_BASE_URL"], settings.get("MANNERPATH_PUBLIC_SITE_URL")))
    if release_origins != [(PRODUCTION_API, PUBLIC_SITE)]:
        fail("build settings (Release): exactly one target must set the canonical production API and public-site origins")


def inspect(path, unsigned, wrapper_release=False):
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
        if not info.get("CFBundleVersion") or not info.get("CFBundleShortVersionString"):
            fail(f"{label}: version/build missing")
        if label in ("iPhone app", "Watch app"):
            privacy = plist(bundle / "PrivacyInfo.xcprivacy")
            if not isinstance(privacy, dict):
                fail(f"{label}: PrivacyInfo.xcprivacy must be a dictionary")
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
        check_release_binary(bundle, info, label)
        print(f"{label}: {actual} | App Group: {GROUP}")
    known = {bundle.resolve() for bundle in bundles.values()}
    for bundle in embedded_bundles(app):
        if bundle.resolve() not in known:
            label = f"embedded {bundle.relative_to(app)}"
            info = plist(bundle / "Info.plist")
            check_release_binary(bundle, info, label)
            infos[label] = info
    for label, info in infos.items():
        check_location_keys(info, label)
    # Every Info.plist at any depth (frameworks and resource bundles too): nested secret keys and unsafe URLs.
    for info_path in sorted(app.rglob("Info.plist")):
        check_info_hygiene(plist(info_path), str(info_path.parent.relative_to(app.parent)))
    for dylib in app.rglob("*.dylib"):
        if dylib.name.endswith(".debug.dylib") or dylib.name == "__preview.dylib":
            fail(f"{dylib.relative_to(app.parent)}: Debug/preview dylib in artifact; build with -configuration Release")
    check_build_settings()
    if infos["iPhone app"].get("UIDeviceFamily") != [1]:
        fail("iPhone app: UIDeviceFamily must be [1] (iPhone-only)")
    if infos["Watch app"].get("WKCompanionAppBundleIdentifier") != IDS["iPhone app"]:
        fail("Watch app: WKCompanionAppBundleIdentifier must name the iPhone app")
    for label in ("iPhone app", "Watch app"):
        check_icon(bundles[label], infos[label], label)
    for label, info in infos.items():
        for key in ("CFBundleVersion", "CFBundleShortVersionString"):
            if info[key] != infos["iPhone app"][key]:
                fail(f"{label}: {key} does not match iPhone app")
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
    if origin != PRODUCTION_API:
        fail("iPhone app: MannerPathAPIBaseURL must match the production Release origin")
    if infos["iPhone app"].get("MannerPathPublicSiteURL") != PUBLIC_SITE:
        fail("iPhone app: MannerPathPublicSiteURL must match the production public site")
    version = infos["iPhone app"].get("CFBundleVersion")
    if not version:
        fail("iPhone app: CFBundleVersion missing; App Attest server allowlisting needs it")
    print(f"MannerPathAPIBaseURL: {origin}")
    print(f"MannerPathPublicSiteURL: {PUBLIC_SITE}")
    print(f"CFBundleVersion for App Attest server: {version}")
    print(f"App Attest declared entitlement: {environment} ({'source file only' if unsigned else 'signed artifact'}; TestFlight uses production)")
    print("Embedding: iPhone widget, Watch app, Watch widget present; Watch companion is the iPhone app")
    print("Hygiene: every embedded Info.plist parsed (nested keys/URLs): HTTPS DNS hosts only, no loopback/IP literal, "
          "no secret-looking key; no Always location key; no Debug UI-test hook or Debug/preview dylib; "
          "project build settings carry no secret-looking name")
    print("Release configuration: archived by apple-beta-preflight.sh with -configuration Release" if wrapper_release else
          "Release configuration: NOT PROVEN for a supplied artifact; only no Debug traces and Release origins observed")
    print("Evidence: UNSIGNED BUILD + source entitlements; no signing/device proof" if unsigned else
          "Evidence: signed artifact entitlements and bundle structure; physical-device behavior still unverified")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact", type=pathlib.Path, help="MannerPath.app or .xcarchive")
    parser.add_argument("--unsigned-build", action="store_true", help="Use source entitlements; never claim signing proof")
    parser.add_argument("--wrapper-release-archive", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        inspect(args.artifact, args.unsigned_build, args.wrapper_release_archive)
    except ValueError as error:
        print(f"FAIL: {error}", file=sys.stderr)
        sys.exit(1)

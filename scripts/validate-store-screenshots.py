#!/usr/bin/env python3
"""Offline technical checks only. Never grants rights/device/submission approval."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

SIZES = {"iphoneLarge": {(1320, 2868), (1260, 2736), (1290, 2796)},
         "iphoneMedium": {(1206, 2622), (1179, 2556)},
         "watch": {(416, 496), (422, 514), (410, 502), (396, 484), (368, 448), (312, 390)}}
ORIGIN = "https://mannerpath-api-production.happywestyuki.workers.dev"


def properties(path):
    result = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", "-g", "hasAlpha", str(path)],
                            check=True, capture_output=True, text=True, timeout=15)
    values = dict(re.findall(r"(pixelWidth|pixelHeight|hasAlpha):\s*(\S+)", result.stdout))
    return int(values["pixelWidth"]), int(values["pixelHeight"]), values["hasAlpha"]


def validate(manifest_path, inspector=properties):
    manifest_path = Path(manifest_path)
    data = json.loads(manifest_path.read_text())
    if (data.get("version") != 1 or data.get("appVersion") != "1.0" or not re.fullmatch(r"[1-9][0-9]*", str(data.get("build", "")))
            or data.get("apiOrigin") != ORIGIN or data.get("locale") != "ja"
            or not all(re.fullmatch(r"[0-9a-f]{40}", data.get(k, "")) for k in ("sourceHead", "sourceTree"))):
        raise ValueError("Invalid capture provenance")
    images = data.get("images")
    if not isinstance(images, list) or not images:
        raise ValueError("No captured images")
    root = manifest_path.resolve().parent
    checked, seen, watch_sizes, counts = [], set(), set(), {}
    for image in images:
        relative = Path(image["file"])
        path = root / relative
        if (relative.is_absolute() or ".." in relative.parts or path.is_symlink()
                or not path.resolve().is_relative_to(root) or not path.is_file()
                or path.suffix.lower() not in {".png", ".jpg", ".jpeg"} or str(relative) in seen):
            raise ValueError("Unsafe, missing or duplicate image path")
        seen.add(str(relative))
        for parent in path.parents:
            if parent == root:
                break
            if parent.is_symlink():
                raise ValueError("Symlink image directory")
        if (image.get("captureKind") not in {"releaseSimulator", "testFlightDevice"}
                or image.get("status") != "candidate" or image.get("syntheticSpotData") is not False
                or image.get("rightsApproved") is not False or image.get("submitReady") is not False
                or not isinstance(image.get("sourceIds"), list) or not image["sourceIds"]
                or not all(isinstance(s, str) and s for s in image["sourceIds"])
                or not isinstance(image.get("spotIds"), list)
                or (not image["spotIds"] and image.get("scene") != "destinationSearch")
                or not all(re.fullmatch(r"sp_[0-9A-HJKMNP-TV-Z]{26}", s) for s in image["spotIds"])):
            raise ValueError("Missing candidate provenance; this tool never approves assets")
        if image.get("physicalDeviceVerified") is not False:
            raise ValueError("Record device approval separately; technical validation cannot grant it")
        width, height, alpha = inspector(path)
        if ((width, height) not in SIZES.get(image.get("platform"), set())
                or (width, height) != (image.get("width"), image.get("height")) or alpha != "no"):
            raise ValueError("Wrong native dimensions or alpha channel")
        content = path.read_bytes()
        is_png = content.startswith(b"\x89PNG\r\n\x1a\n")
        is_jpeg = content.startswith(b"\xff\xd8\xff")
        if not ((path.suffix.lower() == ".png" and is_png)
                or (path.suffix.lower() in {".jpg", ".jpeg"} and is_jpeg)):
            raise ValueError("PNG/JPEG bytes must match the file extension")
        platform = image["platform"]
        counts[platform] = counts.get(platform, 0) + 1
        if counts[platform] > 10:
            raise ValueError("At most 10 screenshots per device size and locale")
        digest = hashlib.sha256(content).hexdigest()
        if digest != image.get("sha256"):
            raise ValueError("Image digest mismatch")
        if image["platform"] == "watch":
            watch_sizes.add((width, height))
        checked.append({"file": str(relative), "width": width, "height": height, "alpha": alpha, "sha256": digest})
    if len(watch_sizes) > 1:
        raise ValueError("Watch sizes must be consistent")
    return {"captureAppVersion": data["appVersion"], "captureBuild": str(data["build"]),
            "technicalValidation": "PASS", "submissionReady": False, "rightsApproval": "PENDING",
            "physicalDeviceVerification": "NOT_PROVEN", "images": checked}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    try:
        report = json.dumps(validate(args.manifest), indent=2, ensure_ascii=False) + "\n"
        if args.report:
            with args.report.open("x") as output:
                output.write(report)
        else:
            print(report, end="")
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError):
        parser.exit(1, "Screenshot validation failed; verify local manifest, files, dimensions and provenance.\n")

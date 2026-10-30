#!/usr/bin/env python3
"""Small JSON/stdin bridge to the pinned Obscura engine used by Vanta."""
import json
import os
import sys
from pathlib import Path

local_vendor = Path(__file__).resolve().parents[3] / "vendor" / "obscura"
root = os.environ.get("OBSCURA_ROOT", "/opt/obscura" if Path("/opt/obscura").is_dir() else str(local_vendor))
if not os.path.isdir(root):
    sys.stderr.write(
        "Obscura source is missing. Run scripts/bootstrap-obscura.sh before local development.\n"
    )
    raise SystemExit(2)
sys.path.insert(0, root)

try:
    from config import paranoid_config
    from obfuscator import Obfuscator

    source = sys.stdin.read(100_001)
    if len(source) > 100_000:
        raise ValueError("Source exceeds the 100 KB build limit.")
    if not source.strip():
        raise ValueError("Source code is empty.")

    # Obscura's PARANOID configuration selects its own VM pipeline.
    # No user source is executed by this adapter; it only parses and transforms it.
    output = Obfuscator(paranoid_config()).obfuscate(source)
    sys.stdout.write(json.dumps({"code": output, "warnings": []}, ensure_ascii=True))
except Exception as exc:
    sys.stderr.write(f"Obscura failed: {type(exc).__name__}: {exc}\n")
    raise SystemExit(1)

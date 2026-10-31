#!/usr/bin/env python3
"""Wuai release contract: actual profile/workflows and isolated updater execution.
No source-brand-only helper, network, credentials or release writes.
"""
import subprocess
from pathlib import Path

subprocess.run(
    ["node", "--experimental-vm-modules", "--test", "scripts/test-wuai-release-assets.mjs"],
    cwd=Path(__file__).resolve().parents[1],
    check=True,
)

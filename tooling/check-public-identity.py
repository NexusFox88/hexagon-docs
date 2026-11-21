#!/usr/bin/env python3
"""Reject private identity strings in publishable repository files."""
from pathlib import Path
import subprocess
import sys

# Code points keep the private identity itself out of public source text.
FORBIDDEN = bytes([109, 97, 114, 107, 111, 118])
root = Path(__file__).resolve().parents[1]
paths = subprocess.check_output(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root
).split(b"\0")
violations = []
checked = 0
for raw in sorted(set(paths)):
    if not raw:
        continue
    name = raw.decode("utf-8")
    path = root / name
    if not path.is_file() or path.is_symlink():
        continue
    checked += 1
    if FORBIDDEN in raw.lower() or FORBIDDEN in path.read_bytes().lower():
        violations.append(name)
if violations:
    print("Private identity found in repository files:", file=sys.stderr)
    for name in violations:
        print(name, file=sys.stderr)
    sys.exit(1)
print(f"Public identity check passed: {checked} files scanned.")

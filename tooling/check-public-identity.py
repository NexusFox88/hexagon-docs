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

if "--history" in sys.argv:
    objects = subprocess.check_output(["git", "rev-list", "--objects", "--all"], cwd=root).splitlines()
    object_ids = [line.split(b" ", 1)[0] for line in objects]
    history_violations = []
    for line in objects:
        if b" " in line and FORBIDDEN in line.split(b" ", 1)[1].lower():
            history_violations.append(line.split(b" ", 1)[0].decode())
    # Communicate through a temporary input file to avoid pipe-buffer deadlocks.
    import tempfile
    with tempfile.TemporaryFile() as requests:
        requests.write(b"\n".join(object_ids) + b"\n")
        requests.seek(0)
        process = subprocess.Popen(["git", "cat-file", "--batch"], cwd=root, stdin=requests, stdout=subprocess.PIPE)
        for object_id in object_ids:
            header = process.stdout.readline().split()
            if len(header) != 3:
                raise RuntimeError("Unable to inspect a Git object")
            data = process.stdout.read(int(header[2]))
            if process.stdout.read(1) != b"\n":
                raise RuntimeError("Invalid Git object boundary")
            if FORBIDDEN in data.lower():
                history_violations.append(object_id.decode())
        if process.wait() != 0:
            raise RuntimeError("Git object inspection failed")
    if history_violations:
        print(f"Private identity found in {len(set(history_violations))} historical objects.", file=sys.stderr)
        sys.exit(1)
    print(f"Public history check passed: {len(object_ids)} reachable objects scanned.")

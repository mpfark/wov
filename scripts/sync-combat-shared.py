#!/usr/bin/env python3
"""
Mirror the C1/C2/C3 combat modules and the Combat2 worker dependency graph
into `supabase/functions/_shared/**`.

Deno needs explicit `.ts` specifiers, so relative imports are rewritten on the
way out. Nothing else is transformed: the mirror must stay byte-comparable so
`src/test/combat/c3/mirror.test.ts` can prove the edge runtime executes the
same resolver the parity sweep validates.

Usage:  python3 scripts/sync-combat-shared.py [--check]
"""
from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src/shared/combat"
DST = ROOT / "supabase/functions/_shared/combat"
TREES = ("pure", "c2", "c3")
COMBAT2_SRC = ROOT / "src/shared/combat2"
COMBAT2_DST = ROOT / "supabase/functions/_shared/combat2"
WORKER_SRC = ROOT / "src/server/combat2/process-node-tick-once.ts"
DISPATCHER_SRC = ROOT / "src/server/combat2/dispatch-node-ticks-once.ts"
INVENTORY_SRC = ROOT / "src/shared/combat/inventory/active-abilities.json"

IMPORT_RE = re.compile(r"(from\s+')(\.[^']*?)(')")
IMPORT_TYPE_RE = re.compile(r"(import\(\s*')(\.[^']*?)('\s*\))")


def to_deno(text: str) -> str:
    def fix(m: re.Match[str]) -> str:
        spec = m.group(2)
        if spec.endswith(".ts") or spec.endswith(".json"):
            return m.group(0)
        return f"{m.group(1)}{spec}.ts{m.group(3)}"

    return IMPORT_TYPE_RE.sub(fix, IMPORT_RE.sub(fix, text))


def read_source(path: Path) -> str:
    """Read without universal-newline translation so mirrors are byte-stable."""
    return path.read_bytes().decode("utf-8")


def write_source(path: Path, text: str) -> None:
    path.write_bytes(text.encode("utf-8"))


def main() -> int:
    check = "--check" in sys.argv
    drift: list[str] = []
    for tree in TREES:
        for src in sorted((SRC / tree).rglob("*.ts")):
            if "__tests__" in src.parts:
                continue
            rel = src.relative_to(SRC)
            dst = DST / rel
            want = to_deno(read_source(src))
            if check:
                if not dst.exists() or read_source(dst) != want:
                    drift.append(str(rel))
            else:
                dst.parent.mkdir(parents=True, exist_ok=True)
                write_source(dst, want)

    combat2_sources = [
        src for src in sorted(COMBAT2_SRC.rglob("*.ts"))
        if "__tests__" not in src.parts
    ]
    for src in combat2_sources:
        rel = src.relative_to(COMBAT2_SRC)
        dst = COMBAT2_DST / rel
        want = to_deno(read_source(src))
        if check:
            if not dst.exists() or read_source(dst) != want:
                drift.append(f"combat2/{rel}")
        else:
            dst.parent.mkdir(parents=True, exist_ok=True)
            write_source(dst, want)

    worker_dst = COMBAT2_DST / "process-node-tick-once.ts"
    worker_want = to_deno(read_source(WORKER_SRC)).replace("../../shared/combat2/", "./")
    if check:
        if not worker_dst.exists() or read_source(worker_dst) != worker_want:
            drift.append("combat2/process-node-tick-once.ts")
    else:
        worker_dst.parent.mkdir(parents=True, exist_ok=True)
        write_source(worker_dst, worker_want)

    dispatcher_dst = COMBAT2_DST / "dispatch-node-ticks-once.ts"
    dispatcher_want = to_deno(read_source(DISPATCHER_SRC))
    if check:
        if not dispatcher_dst.exists() or read_source(dispatcher_dst) != dispatcher_want:
            drift.append("combat2/dispatch-node-ticks-once.ts")
    else:
        dispatcher_dst.parent.mkdir(parents=True, exist_ok=True)
        write_source(dispatcher_dst, dispatcher_want)

    inventory_dst = COMBAT2_DST / "active-abilities.json"
    if check:
        if not inventory_dst.exists() or inventory_dst.read_bytes() != INVENTORY_SRC.read_bytes():
            drift.append("combat2/active-abilities.json")
    else:
        inventory_dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(INVENTORY_SRC, inventory_dst)
    if check and drift:
        print("combat shared mirror drift:\n  " + "\n  ".join(drift))
        return 1
    print("combat shared mirror: in sync" if check else "combat shared mirror: written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""
Mirror the C1/C2/C3 combat modules from `src/shared/combat/**` into
`supabase/functions/_shared/combat/**`.

Deno needs explicit `.ts` specifiers, so relative imports are rewritten on the
way out. Nothing else is transformed: the mirror must stay byte-comparable so
`src/test/combat/c3/mirror.test.ts` can prove the edge runtime executes the
same resolver the parity sweep validates.

Usage:  python3 scripts/sync-combat-shared.py [--check]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src/shared/combat"
DST = ROOT / "supabase/functions/_shared/combat"
TREES = ("pure", "c2", "c3")

IMPORT_RE = re.compile(r"(from\s+')(\.[^']*?)(')")


def to_deno(text: str) -> str:
    def fix(m: re.Match[str]) -> str:
        spec = m.group(2)
        if spec.endswith(".ts") or spec.endswith(".json"):
            return m.group(0)
        return f"{m.group(1)}{spec}.ts{m.group(3)}"

    return IMPORT_RE.sub(fix, text)


def main() -> int:
    check = "--check" in sys.argv
    drift: list[str] = []
    for tree in TREES:
        for src in sorted((SRC / tree).rglob("*.ts")):
            if "__tests__" in src.parts:
                continue
            rel = src.relative_to(SRC)
            dst = DST / rel
            want = to_deno(src.read_text())
            if check:
                if not dst.exists() or dst.read_text() != want:
                    drift.append(str(rel))
            else:
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_text(want)
    if check and drift:
        print("combat shared mirror drift:\n  " + "\n  ".join(drift))
        return 1
    print("combat shared mirror: in sync" if check else "combat shared mirror: written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

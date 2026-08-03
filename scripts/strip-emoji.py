#!/usr/bin/env python3
"""
One-shot codemod: remove emoji literals from maintained sources.

Kept deliberately (typographic, not pictographic): arrows (U+2190-U+21FF),
star/asterism ornaments (U+2605 U+2606 U+2726 U+2767), check/cross marks
(U+2713 U+2715) and gender signs (U+2640 U+2642).

Usage: python3 scripts/strip-emoji.py <path> [<path> ...]
"""
import re
import sys
from pathlib import Path

KEEP = {
    0x2605, 0x2606, 0x2713, 0x2715, 0x2726, 0x2767, 0x2640, 0x2642,
}

RANGES = [
    (0x1F000, 0x1FAFF),
    (0x1F1E6, 0x1F1FF),
    (0x2600, 0x27BF),
    (0x2B00, 0x2BFF),
    (0x2934, 0x2935),
    (0x3030, 0x3030),
    (0x303D, 0x303D),
    (0x2049, 0x2049),
    (0x203C, 0x203C),
]

MODIFIERS = {0xFE0F, 0xFE0E, 0x200D, 0x20E3}
SKIN = range(0x1F3FB, 0x1F400)


def is_emoji(ch: str) -> bool:
    cp = ord(ch)
    if cp in KEEP:
        return False
    if cp in MODIFIERS or cp in SKIN:
        return False
    return any(lo <= cp <= hi for lo, hi in RANGES)


CLUSTER = re.compile(
    r'(?:[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\u2934\u2935\u3030\u303D\u2049\u203C]'
    r'[\uFE0E\uFE0F\u200D\u20E3\U0001F3FB-\U0001F3FF]*)+'
)

OPEN_CHARS = set("'\"`(<{[,:=+")
CLOSE_CHARS = set("'\"`)>}],:;.!?")


def strip_line(line: str) -> str:
    out = []
    i = 0
    while True:
        m = CLUSTER.search(line, i)
        if not m:
            out.append(line[i:])
            break
        text = m.group(0)
        if not any(is_emoji(c) for c in text):
            out.append(line[i:m.end()])
            i = m.end()
            continue
        head = line[i:m.start()]
        start = m.start()
        end = m.end()
        # swallow surrounding single spaces
        left_trimmed = head
        while left_trimmed.endswith(' '):
            left_trimmed = left_trimmed[:-1]
        right = line[end:]
        right_trimmed = right.lstrip(' ')

        prev = left_trimmed[-1] if left_trimmed else ''
        nxt = right_trimmed[0] if right_trimmed else ''
        drop_all = (
            prev == '' or prev in OPEN_CHARS or nxt == '' or nxt in CLOSE_CHARS
        )
        if drop_all:
            # preserve pure indentation when the emoji began the line content
            if left_trimmed.strip() == '' and left_trimmed:
                out.append(left_trimmed)
            else:
                out.append(left_trimmed)
            i = end + (len(right) - len(right_trimmed))
        else:
            out.append(left_trimmed + ' ')
            i = end + (len(right) - len(right_trimmed))
    return ''.join(out)


def process(path: Path) -> bool:
    try:
        src = path.read_text(encoding='utf-8')
    except (UnicodeDecodeError, OSError):
        return False
    if not any(is_emoji(c) for c in src):
        return False
    new = '\n'.join(strip_line(l) for l in src.split('\n'))
    if new != src:
        path.write_text(new, encoding='utf-8')
        return True
    return False


def main() -> None:
    exts = {'.ts', '.tsx', '.js', '.jsx', '.sql', '.css', '.html', '.md', '.json'}
    changed = 0
    for arg in sys.argv[1:]:
        root = Path(arg)
        files = [root] if root.is_file() else [p for p in root.rglob('*') if p.suffix in exts]
        for f in files:
            if 'node_modules' in f.parts:
                continue
            if process(f):
                changed += 1
                print('stripped', f)
    print(f'{changed} files changed')


if __name__ == '__main__':
    main()

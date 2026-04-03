from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'src'
ENTRY = SRC / 'main.js'
OUT = ROOT / 'app.bundle.js'

IMPORT_RE = re.compile(r"^\s*import\s+[^;]+?\s+from\s+['\"](.+?)['\"];\s*$", re.M)
EXPORT_RE = re.compile(r'^\s*export\s+', re.M)


def resolve_module(current: Path, ref: str) -> Path:
    path = (current.parent / ref).resolve()
    if path.is_dir():
        return path / 'index.js'
    if path.suffix:
        return path
    return path.with_suffix('.js')


def strip_imports_and_exports(source: str) -> str:
    source = IMPORT_RE.sub('', source)
    source = EXPORT_RE.sub('', source)
    return source.strip() + '\n'


def collect(path: Path, seen: set[Path], ordered: list[Path]) -> None:
    path = path.resolve()
    if path in seen:
        return
    seen.add(path)
    source = path.read_text(encoding='utf-8')
    for ref in IMPORT_RE.findall(source):
        if not ref.startswith('.'):
            raise RuntimeError(f'Only relative imports are supported: {path} -> {ref}')
        collect(resolve_module(path, ref), seen, ordered)
    ordered.append(path)


def main() -> None:
    ordered: list[Path] = []
    collect(ENTRY, set(), ordered)
    chunks = [
        '/* Auto-generated local bundle. Open index.html directly. */',
        '(function () {',
        "'use strict';",
    ]
    for path in ordered:
      rel = path.relative_to(ROOT).as_posix()
      code = strip_imports_and_exports(path.read_text(encoding='utf-8'))
      chunks.append(f"\n/* ===== {rel} ===== */\n")
      chunks.append(code)
    chunks.append('\n})();\n')
    OUT.write_text('\n'.join(chunks), encoding='utf-8')
    print(f'Wrote {OUT}')


if __name__ == '__main__':
    main()

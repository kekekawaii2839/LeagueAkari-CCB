"""Inspect frozen code, never execute it; reject local source-path leaks."""
import json
import marshal
import re
import sys
import types
from pathlib import Path
from PyInstaller.archive.readers import CArchiveReader

archive = CArchiveReader(sys.argv[1])
count = 0
modules = []
violations = []

def visit(code):
    global count
    if not isinstance(code, types.CodeType):
        return
    count += 1
    # Frozen filenames must be portable; inspect nested functions as well.
    if re.match(r"^(?:[A-Za-z]:[\\/]|[\\/])", code.co_filename):
        violations.append("absolute code filename")
    for value in code.co_consts:
        if isinstance(value, types.CodeType):
            visit(value)
        elif isinstance(value, str) and re.search(r"[A-Za-z]:[\\/]Users[\\/][^\\/]+[\\/](?:Documents|AppData)[\\/]", value, re.I):
            violations.append("local user source constant")

for name, entry in archive.toc.items():
    if entry[-1] in ("s", "m", "M"):
        visit(marshal.loads(archive.extract(name)))
    elif entry[-1] == "z":
        pyz = archive.open_embedded_archive(name)
        for module in pyz.toc:
            visit(pyz.extract(module))
            if module.startswith("member_analysis"):
                modules.append(module)
if not all("member_analysis." + m in modules for m in ("worker", "analysis", "opgg")):
    raise SystemExit("Required source-current worker modules missing")
if violations:
    raise SystemExit("Frozen worker local-path scan failed: " + str(len(violations)))
print(json.dumps({"passed": True, "codeObjects": count, "memberAnalysisModules": modules, "absoluteSourcePaths": 0}))

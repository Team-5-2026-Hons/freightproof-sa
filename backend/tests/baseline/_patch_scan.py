"""Alias-aware AST scan for test patches (used by B8 and for the patch-site inventory).

Why this is not a grep: patches are routinely written across several lines
(`monkeypatch.setattr(\\n    phase_service,\\n    "_gate_and_load", ...)`) and through
aliases (`from app.orchestration import phase_service as ps`), and both defeat a line-based
search. The audit's first inventory undercounted for exactly that reason (8 / 22 / 37
instead of 13 / 22 / 38). This resolves every patch target to a dotted path first.

What counts as a patch site, wherever it appears (statement, `with`, decorator, fixture):
  * unittest.mock.patch(target, ...)           target is a dotted string
  * unittest.mock.patch.object(obj, "name")    obj is an expression
  * unittest.mock.patch.multiple(obj, ...)     obj is an expression or a dotted string
  * <anything>.setattr(target, ...)            monkeypatch.setattr, any receiver name
  * mocker.patch / mocker.patch.object         the pytest-mock spellings
A patch target held in a module-level string constant is resolved too:
  * _ANCHOR = "app.x.facade.fn"; patch(_ANCHOR)   plain and annotated `NAME = "<str>"`
    (an import of the same name wins; constants bound anywhere but module level are not seen)
A site "targets" a module when its resolved dotted path equals the module or sits below
it, so `patch("app.x.facade.dep.fn")` (a dependency patched THROUGH the facade) counts.
"""

import ast
from dataclasses import dataclass
from pathlib import Path

_MOCK_PATCH_CALLABLES = frozenset({
    "unittest.mock.patch",
    "unittest.mock.patch.object",
    "unittest.mock.patch.multiple",
})
# The third-party `mock` package spells it the same way under a different root.
_MOCK_PACKAGE_ROOT = "mock.patch"
_MOCKER_PATCH_CHAINS = frozenset({
    ("mocker", "patch"), ("mocker", "patch", "object"), ("mocker", "patch", "multiple"),
})
_TARGET_KEYWORD = "target"


@dataclass(frozen=True)
class PatchSite:
    path: str
    line: int
    target: str  # resolved dotted path of the patched object


def _collect_aliases(tree: ast.AST) -> dict[str, str]:
    """name -> dotted path, for every import anywhere in the file (function-level too)."""
    aliases: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for imported in node.names:
                if imported.asname:
                    aliases[imported.asname] = imported.name
                else:
                    # `import a.b.c` binds only `a`; the attribute chain supplies the rest.
                    root = imported.name.split(".")[0]
                    aliases[root] = root
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            for imported in node.names:
                aliases[imported.asname or imported.name] = f"{node.module}.{imported.name}"
    return aliases


def _collect_string_constants(tree: ast.Module) -> dict[str, str]:
    """name -> value, for module-level `NAME = "<str>"` and `NAME: str = "<str>"`.

    Module level only: that is where a test file keeps a patch target it reuses, and a
    function-local name could be rebound between the assignment and the patch call."""
    constants: dict[str, str] = {}
    for statement in tree.body:
        if isinstance(statement, ast.Assign):
            targets, value = statement.targets, statement.value
        elif isinstance(statement, ast.AnnAssign) and statement.value is not None:
            targets, value = [statement.target], statement.value
        else:
            continue
        if isinstance(value, ast.Constant) and isinstance(value.value, str):
            for target in targets:
                if isinstance(target, ast.Name):
                    constants[target.id] = value.value
    return constants


def _raw_chain(node: ast.expr) -> tuple[str, ...] | None:
    """('a', 'b', 'c') for a.b.c made only of names and attributes; None otherwise."""
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return tuple(reversed(parts))
    return None


def _resolve(node: ast.expr, aliases: dict[str, str], constants: dict[str, str] | None = None) -> str | None:
    """Dotted path of a string literal, of a bare name bound to a module-level string
    constant, or of a name/attribute chain rooted at an import."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    # Imports keep priority: a name that is both imported and assigned is treated as the import.
    if isinstance(node, ast.Name) and node.id not in aliases and constants and node.id in constants:
        return constants[node.id]
    chain = _raw_chain(node)
    if chain is None or chain[0] not in aliases:
        return None
    return ".".join([aliases[chain[0]], *chain[1:]])


def _is_patch_call(func: ast.expr, aliases: dict[str, str]) -> bool:
    chain = _raw_chain(func)
    if chain is None:
        return False
    if chain in _MOCKER_PATCH_CHAINS:
        return True
    if chain[-1] == "setattr" and len(chain) > 1:
        return True
    resolved = _resolve(func, aliases)
    return resolved is not None and (
        resolved in _MOCK_PATCH_CALLABLES
        or resolved == _MOCK_PACKAGE_ROOT
        or resolved.startswith(_MOCK_PACKAGE_ROOT + ".")
    )


def find_patch_sites(source: str, path: str = "<source>") -> list[PatchSite]:
    tree = ast.parse(source, filename=path)
    aliases = _collect_aliases(tree)
    constants = _collect_string_constants(tree)
    sites: list[PatchSite] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not _is_patch_call(node.func, aliases):
            continue
        target_node: ast.expr | None = node.args[0] if node.args else None
        if target_node is None:
            keyword = next((kw for kw in node.keywords if kw.arg == _TARGET_KEYWORD), None)
            target_node = keyword.value if keyword else None
        if target_node is None:
            continue
        target = _resolve(target_node, aliases, constants)
        if target is not None:
            sites.append(PatchSite(path=path, line=node.lineno, target=target))
    return sites


def targets_module(site: PatchSite, module: str) -> bool:
    return site.target == module or site.target.startswith(module + ".")


def scan_tree(root: Path) -> list[PatchSite]:
    sites: list[PatchSite] = []
    for file in sorted(root.rglob("*.py")):
        sites.extend(find_patch_sites(file.read_text(encoding="utf-8"), str(file.relative_to(root))))
    return sites

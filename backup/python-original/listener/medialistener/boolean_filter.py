"""Mini Boolean engine.

Sintaks:  korupsi AND (BUMN OR "dana pensiun") NOT hoax
  - Operator AND / OR / NOT harus HURUF BESAR (agar kata biasa tidak tertukar).
  - Dua term berdampingan = AND.  "frasa pasti" pakai kutip.  kata* = awalan (korup* -> korupsi, korupsinya).
  - Pencocokan tidak peka huruf besar/kecil dan per kata utuh (banjir tidak cocok dengan 'membanjiri').
"""
from __future__ import annotations

import re
from typing import Union

Node = Union[tuple, str]


def _tokenize(q: str) -> list[tuple[str, str]]:
    tokens, i = [], 0
    while i < len(q):
        c = q[i]
        if c.isspace():
            i += 1
        elif c in "()":
            tokens.append((c, c))
            i += 1
        elif c == '"':
            j = q.find('"', i + 1)
            if j == -1:
                raise ValueError("Tanda kutip tidak ditutup")
            tokens.append(("TERM", q[i + 1:j]))
            i = j + 1
        else:
            j = i
            while j < len(q) and not q[j].isspace() and q[j] not in '()"':
                j += 1
            w = q[i:j]
            tokens.append((w, w) if w in ("AND", "OR", "NOT") else ("TERM", w))
            i = j
    return tokens


def _term_regex(term: str) -> re.Pattern:
    prefix = term.endswith("*")
    body = r"\s+".join(re.escape(part) for part in term.rstrip("*").split())
    return re.compile(r"(?<!\w)" + body + (r"\w*" if prefix else r"(?!\w)"), re.IGNORECASE)


class BooleanQuery:
    def __init__(self, expression: str):
        self.expression = expression.strip()
        self._tokens = _tokenize(self.expression)
        if not self._tokens:
            raise ValueError("Query kosong")
        self._pos = 0
        self.terms: list[str] = []
        self._tree = self._parse_or()
        if self._pos != len(self._tokens):
            raise ValueError(f"Sintaks tidak valid dekat '{self._tokens[self._pos][1]}'")

    # --- recursive descent: OR < AND (eksplisit/implisit) < NOT < atom ---
    def _peek(self):
        return self._tokens[self._pos][0] if self._pos < len(self._tokens) else None

    def _parse_or(self) -> Node:
        left = self._parse_and()
        while self._peek() == "OR":
            self._pos += 1
            left = ("or", left, self._parse_and())
        return left

    def _parse_and(self) -> Node:
        left = self._parse_not()
        while self._peek() in ("AND", "NOT", "TERM", "("):
            if self._peek() == "AND":
                self._pos += 1
            left = ("and", left, self._parse_not())
        return left

    def _parse_not(self) -> Node:
        if self._peek() == "NOT":
            self._pos += 1
            return ("not", self._parse_not())
        return self._parse_atom()

    def _parse_atom(self) -> Node:
        kind = self._peek()
        if kind == "(":
            self._pos += 1
            node = self._parse_or()
            if self._peek() != ")":
                raise ValueError("Kurung tidak ditutup")
            self._pos += 1
            return node
        if kind == "TERM":
            term = self._tokens[self._pos][1]
            self._pos += 1
            self.terms.append(term)
            return ("term", _term_regex(term))
        raise ValueError("Query tidak lengkap (operator tanpa operand)")

    def _eval(self, node: Node, text: str) -> bool:
        op = node[0]
        if op == "term":
            return node[1].search(text) is not None
        if op == "and":
            return self._eval(node[1], text) and self._eval(node[2], text)
        if op == "or":
            return self._eval(node[1], text) or self._eval(node[2], text)
        return not self._eval(node[1], text)

    def matches(self, text: str) -> bool:
        return self._eval(self._tree, text or "")


def parse_queries(specs: list[str]) -> dict[str, BooleanQuery]:
    """Terima 'nama: ekspresi' atau 'ekspresi' saja (nama = ekspresinya). Baris kosong/# diabaikan."""
    out: dict[str, BooleanQuery] = {}
    for spec in specs:
        spec = spec.strip()
        if not spec or spec.startswith("#"):
            continue
        name, expr = (spec.split(":", 1) if re.match(r"^[\w .-]{1,40}:\s", spec) else (spec, spec))
        out[name.strip()] = BooleanQuery(expr)
    return out

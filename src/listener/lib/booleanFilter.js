// Mini Boolean engine.
//
// Sintaks:  korupsi AND (BUMN OR "dana pensiun") NOT hoax
//   - Operator AND / OR / NOT harus HURUF BESAR (agar kata biasa tidak tertukar).
//   - Dua term berdampingan = AND.  "frasa pasti" pakai kutip.  kata* = awalan (korup* -> korupsi, korupsinya).
//   - Pencocokan tidak peka huruf besar/kecil dan per kata utuh (banjir tidak cocok dengan 'membanjiri').

export class ValueError extends Error {}

const W = '[\\p{L}\\p{N}_]';                        // \w Unicode
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function tokenize(q) {
  const tokens = [];
  let i = 0;
  while (i < q.length) {
    const c = q[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === '(' || c === ')') {
      tokens.push([c, c]);
      i++;
    } else if (c === '"') {
      const j = q.indexOf('"', i + 1);
      if (j === -1) throw new ValueError('Tanda kutip tidak ditutup');
      tokens.push(['TERM', q.slice(i + 1, j)]);
      i = j + 1;
    } else {
      let j = i;
      while (j < q.length && !/\s/.test(q[j]) && !'()"'.includes(q[j])) j++;
      const w = q.slice(i, j);
      tokens.push(['AND', 'OR', 'NOT'].includes(w) ? [w, w] : ['TERM', w]);
      i = j;
    }
  }
  return tokens;
}

function termRegex(term) {
  const prefix = term.endsWith('*');
  const body = term.replace(/\*+$/, '').split(/\s+/).filter(Boolean).map(escapeRe).join('\\s+');
  return new RegExp(`(?<!${W})${body}${prefix ? `${W}*` : `(?!${W})`}`, 'iu');
}

export class BooleanQuery {
  constructor(expression) {
    this.expression = expression.trim();
    this._tokens = tokenize(this.expression);
    if (!this._tokens.length) throw new ValueError('Query kosong');
    this._pos = 0;
    this.terms = [];
    this._tree = this._parseOr();
    if (this._pos !== this._tokens.length) throw new ValueError(`Sintaks tidak valid dekat '${this._tokens[this._pos][1]}'`);
  }

  // recursive descent: OR < AND (eksplisit/implisit) < NOT < atom
  _peek() { return this._pos < this._tokens.length ? this._tokens[this._pos][0] : null; }

  _parseOr() {
    let left = this._parseAnd();
    while (this._peek() === 'OR') {
      this._pos++;
      left = ['or', left, this._parseAnd()];
    }
    return left;
  }

  _parseAnd() {
    let left = this._parseNot();
    while (['AND', 'NOT', 'TERM', '('].includes(this._peek())) {
      if (this._peek() === 'AND') this._pos++;
      left = ['and', left, this._parseNot()];
    }
    return left;
  }

  _parseNot() {
    if (this._peek() === 'NOT') {
      this._pos++;
      return ['not', this._parseNot()];
    }
    return this._parseAtom();
  }

  _parseAtom() {
    const kind = this._peek();
    if (kind === '(') {
      this._pos++;
      const node = this._parseOr();
      if (this._peek() !== ')') throw new ValueError('Kurung tidak ditutup');
      this._pos++;
      return node;
    }
    if (kind === 'TERM') {
      const term = this._tokens[this._pos][1];
      this._pos++;
      this.terms.push(term);
      return ['term', termRegex(term)];
    }
    throw new ValueError('Query tidak lengkap (operator tanpa operand)');
  }

  _eval(node, text) {
    switch (node[0]) {
      case 'term': return node[1].test(text);
      case 'and': return this._eval(node[1], text) && this._eval(node[2], text);
      case 'or': return this._eval(node[1], text) || this._eval(node[2], text);
      default: return !this._eval(node[1], text);
    }
  }

  matches(text) { return this._eval(this._tree, text || ''); }
}

/** Terima 'nama: ekspresi' atau 'ekspresi' saja (nama = ekspresinya). Baris kosong/# diabaikan. */
export function parseQueries(specs) {
  const out = new Map();
  for (let spec of specs) {
    spec = spec.trim();
    if (!spec || spec.startsWith('#')) continue;
    let name = spec, expr = spec;
    if (/^[\p{L}\p{N}_ .-]{1,40}:\s/u.test(spec)) {
      const k = spec.indexOf(':');
      name = spec.slice(0, k);
      expr = spec.slice(k + 1);
    }
    out.set(name.trim(), new BooleanQuery(expr));
  }
  return out;
}

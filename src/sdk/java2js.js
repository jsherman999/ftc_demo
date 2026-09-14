// Java (OnBot Java / Android Studio OpMode subset) -> JavaScript translator.
//
// Goals: a student pastes the Java they would upload to a Control Hub and it
// runs against the simulator's SDK look-alike without edits. Line numbers are
// preserved so runtime errors point at the Java source line.
//
// What is translated
//   * package / import lines                -> dropped
//   * @TeleOp / @Autonomous / @Disabled     -> OpMode registration
//   * class Foo extends Bar                 -> function Foo() {...} + prototype methods,
//                                              with (this) {...} for implicit field access
//   * fields, static fields, constructors, methods, static methods, simple enums,
//     nested static classes
//   * typed declarations, casts, generics, .class literals, for-each, catch,
//     lambdas (->), array creation/initialisers, super calls, String.length()
//   * int/long typed assignments are truncated like Java integer arithmetic
// Not supported (a warning is produced): anonymous inner classes, interfaces,
// inner (non-static) classes that touch outer fields, method overloading by type.

const KEYWORDS = new Set(('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var').split(' '));
const PRIMITIVES = new Set(['boolean', 'byte', 'char', 'short', 'int', 'long', 'float', 'double', 'void', 'var']);
const INT_TYPES = new Set(['byte', 'short', 'int', 'long']);
const MODIFIERS = new Set(['public', 'private', 'protected', 'static', 'final', 'abstract', 'synchronized', 'transient', 'volatile', 'native', 'strictfp', 'default']);
const SDK_INSTANCE_NAMES = ['telemetry', 'hardwareMap', 'gamepad1', 'gamepad2', 'time', 'sleep', 'idle', 'waitForStart', 'opModeIsActive', 'isStopRequested', 'opModeInInit', 'isStarted', 'getRuntime', 'resetRuntime', 'requestOpModeStop', 'terminateOpModeNow', 'runOpMode', 'init', 'init_loop', 'start', 'loop', 'stop'];

// ---- tokenizer ----------------------------------------------------------------
export function tokenize(src) {
  const toks = [];
  let i = 0, line = 1;
  const n = src.length;
  const push = (t, v) => toks.push({ t, v, line });
  while (i < n) {
    const c = src[i];
    if (c === '\n') { push('nl', '\n'); line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f') {
      let j = i; while (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\r' || src[j] === '\f')) j++;
      push('ws', src.slice(i, j)); i = j; continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      let j = i; while (j < n && src[j] !== '\n') j++;
      push('cmt', src.slice(i, j)); i = j; continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      let j = src.indexOf('*/', i + 2); if (j < 0) j = n; else j += 2;
      const text = src.slice(i, j);
      push('cmt', text);
      line += (text.match(/\n/g) || []).length;
      i = j; continue;
    }
    if (c === '"') {
      if (src.startsWith('"""', i)) { // text block
        let j = src.indexOf('"""', i + 3); if (j < 0) j = n; else j += 3;
        const raw = src.slice(i + 3, j - 3).replace(/^\s*\n/, '');
        push('str', JSON.stringify(raw)); line += (src.slice(i, j).match(/\n/g) || []).length; i = j; continue;
      }
      let j = i + 1;
      while (j < n && src[j] !== '"') { if (src[j] === '\\') j++; j++; }
      push('str', src.slice(i, j + 1)); i = j + 1; continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== "'") { if (src[j] === '\\') j++; j++; }
      push('chr', src.slice(i, j + 1)); i = j + 1; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i;
      if (c === '0' && /[xX]/.test(src[i + 1] || '')) { j = i + 2; while (j < n && /[0-9a-fA-F_]/.test(src[j])) j++; }
      else if (c === '0' && /[bB]/.test(src[i + 1] || '')) { j = i + 2; while (j < n && /[01_]/.test(src[j])) j++; }
      else {
        while (j < n && /[0-9_]/.test(src[j])) j++;
        if (src[j] === '.' && /[0-9]/.test(src[j + 1] || '')) { j++; while (j < n && /[0-9_]/.test(src[j])) j++; }
        else if (src[j] === '.' && !/[a-zA-Z_]/.test(src[j + 1] || '')) { j++; }
        if (/[eE]/.test(src[j] || '') && /[0-9+-]/.test(src[j + 1] || '')) { j += 2; while (j < n && /[0-9]/.test(src[j])) j++; }
      }
      let text = src.slice(i, j);
      let suffix = '';
      if (/[lLfFdD]/.test(src[j] || '') && !/[xX]/.test(text[1] || '')) { suffix = src[j]; j++; }
      else if (/[lL]/.test(src[j] || '')) { suffix = src[j]; j++; }
      text = text.replace(/_/g, '');
      if (/[fFdD]/.test(suffix) && !text.includes('.') && !/[eE]/.test(text)) text += '.0';
      push('num', text.endsWith('.') ? text + '0' : text); i = j; continue;
    }
    if (/[a-zA-Z_$]/.test(c)) {
      let j = i; while (j < n && /[a-zA-Z0-9_$]/.test(src[j])) j++;
      const v = src.slice(i, j);
      push(KEYWORDS.has(v) ? 'kw' : 'id', v); i = j; continue;
    }
    if (c === '@') { push('at', '@'); i++; continue; }
    // operators
    const ops = ['>>>=', '<<=', '>>=', '>>>', '...', '->', '::', '++', '--', '&&', '||', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>'];
    let matched = null;
    for (const op of ops) if (src.startsWith(op, i)) { matched = op; break; }
    if (matched) { push('op', matched); i += matched.length; continue; }
    push('op', c); i++;
  }
  return toks;
}

// ---- translator -------------------------------------------------------------------
export function translateJava(src) {
  const t = new Translator(src);
  return t.run();
}

class Translator {
  constructor(src) {
    this.src = src;
    this.toks = tokenize(src);
    this.out = [];
    this.warnings = [];
    this.classes = [];      // {name, base, meta}
    this.pos = 0;
    this.buildMatches();
  }

  warn(msg, tok) { this.warnings.push(`${tok ? 'line ' + tok.line + ': ' : ''}${msg}`); }

  buildMatches() {
    this.match = new Array(this.toks.length).fill(-1);
    const stack = [];
    const pairs = { '(': ')', '[': ']', '{': '}' };
    for (let i = 0; i < this.toks.length; i++) {
      const tk = this.toks[i];
      if (tk.t !== 'op') continue;
      if (pairs[tk.v]) stack.push(i);
      else if (tk.v === ')' || tk.v === ']' || tk.v === '}') {
        const j = stack.pop();
        if (j !== undefined) { this.match[j] = i; this.match[i] = j; }
      }
    }
  }

  // token helpers
  isSig(i) { const tk = this.toks[i]; return tk && tk.t !== 'ws' && tk.t !== 'nl' && tk.t !== 'cmt'; }
  next(i) { let j = i + 1; while (j < this.toks.length && !this.isSig(j)) j++; return j; }
  prev(i) { let j = i - 1; while (j >= 0 && !this.isSig(j)) j--; return j; }
  tok(i) { return this.toks[i] || { t: 'eof', v: '' }; }
  is(i, v, t) { const tk = this.tok(i); return tk.v === v && (!t || tk.t === t); }
  emit(s) { this.out.push(s); }
  /** Emit only the newlines (and comments) in [a, b] so line numbers survive. */
  dropRange(a, b) {
    for (let i = a; i <= b; i++) { const tk = this.toks[i]; if (tk && (tk.t === 'nl' || tk.t === 'cmt')) this.out.push(tk.v); }
  }
  copyTrivia(i) { const tk = this.tok(i); if (tk.t === 'ws' || tk.t === 'nl' || tk.t === 'cmt') { this.out.push(tk.v); return true; } return false; }

  run() {
    const n = this.toks.length;
    let i = 0;
    let pendingAnn = [];
    while (i < n) {
      const tk = this.toks[i];
      if (this.copyTrivia(i)) { i++; continue; }
      if (tk.t === 'kw' && (tk.v === 'package' || tk.v === 'import')) {
        let j = i; while (j < n && !this.is(j, ';')) j++;
        this.emit('// ' + this.toks.slice(i, j).map((x) => x.v).join('').replace(/\n/g, ' '));
        this.dropRange(i, j);
        i = j + 1; continue;
      }
      if (tk.t === 'at') { const r = this.parseAnnotation(i); pendingAnn.push(r.ann); i = r.end; continue; }
      if (tk.t === 'kw' && MODIFIERS.has(tk.v)) { i++; continue; }
      if (tk.t === 'kw' && (tk.v === 'class' || tk.v === 'enum' || tk.v === 'interface')) {
        i = this.parseType(i, pendingAnn, null);
        pendingAnn = [];
        continue;
      }
      if (this.is(i, ';')) { i++; continue; }
      // unexpected top-level token: copy through
      this.emit(tk.v); i++;
    }
    // link prototypes and register OpModes
    const tail = [...(this.deferred || [])];
    for (const c of this.classes) {
      if (c.base) tail.push(`Object.setPrototypeOf(${c.name}.prototype, ${c.base}.prototype); Object.setPrototypeOf(${c.name}, ${c.base});`);
    }
    for (const c of this.classes) {
      const meta = c.meta;
      if (!meta) continue;
      tail.push(`__registerOpMode(${JSON.stringify(meta)}, ${c.name});`);
    }
    if (tail.length) this.emit('\n' + tail.join('\n') + '\n');
    return { code: this.out.join(''), warnings: this.warnings, classes: this.classes.map((c) => ({ name: c.name, base: c.base, meta: c.meta })) };
  }

  // ---- annotations --------------------------------------------------------------
  parseAnnotation(i) {
    // @Name or @Name(args)
    const nameIdx = this.next(i);
    const name = this.tok(nameIdx).v;
    let end = nameIdx + 1;
    let args = null;
    const p = this.next(nameIdx);
    if (this.is(p, '(')) {
      const close = this.match[p];
      args = this.toks.slice(p + 1, close).filter((x) => x.t !== 'ws' && x.t !== 'nl' && x.t !== 'cmt');
      end = close + 1;
    }
    this.dropRange(i, end - 1);
    const ann = { name, args: {} };
    if (args) {
      // key = value pairs, or a single value
      let k = null, buf = [];
      const flush = () => { if (buf.length) { ann.args[k || 'value'] = buf.map((x) => x.v).join(''); buf = []; k = null; } };
      for (let a = 0; a < args.length; a++) {
        if (args[a].t === 'id' && args[a + 1] && args[a + 1].v === '=') { k = args[a].v; a++; continue; }
        if (args[a].v === ',') { flush(); continue; }
        buf.push(args[a]);
      }
      flush();
    }
    return { ann, end };
  }

  metaFromAnnotations(anns, className) {
    let meta = null;
    for (const a of anns) {
      if (a.name === 'TeleOp' || a.name === 'Autonomous') {
        meta = meta || {};
        meta.type = a.name;
        meta.name = unquote(a.args.name || a.args.value) || className;
        meta.group = unquote(a.args.group) || '';
        if (a.args.preselectTeleOp) meta.preselectTeleOp = unquote(a.args.preselectTeleOp);
      }
      if (a.name === 'Disabled') { meta = meta || {}; meta.disabled = true; }
    }
    if (meta && !meta.type) return null; // @Disabled alone
    return meta;
  }

  // ---- types (class / enum / interface) -----------------------------------------------
  parseType(i, anns, outer) {
    const kind = this.tok(i).v;
    const nameIdx = this.next(i);
    const name = this.tok(nameIdx).v;
    let j = this.next(nameIdx);
    // generic parameters
    if (this.is(j, '<')) j = this.skipAngle(j) ;
    let base = null;
    while (!this.is(j, '{') && j < this.toks.length) {
      if (this.is(j, 'extends', 'kw')) {
        const b = this.next(j);
        if (kind === 'class') base = this.readTypeName(b).name;
        j = this.next(j);
      } else j = this.next(j);
    }
    const open = j, close = this.match[open];
    if (close < 0) throw new Error(`line ${this.tok(open).line}: unbalanced braces in ${kind} ${name}`);
    if (kind === 'interface') {
      this.warn(`interface ${name} is ignored (interfaces are not needed in the simulator)`, this.tok(i));
      this.emit(`var ${name} = function ${name}() {};`);
      this.dropRange(i, close);
      return close + 1;
    }
    const meta = this.metaFromAnnotations(anns, name);
    const cls = { name, base, meta, fields: new Set(), intFields: new Set(), methods: new Set(), kind, outer };
    this.classes.push(cls);
    // header line: constructor function + bookkeeping
    this.dropRange(i, open - 1);
    const baseCall = base ? `${base}.call(this);` : '';
    this.emit(`function ${name}() { ${baseCall} ${name}.__fields.forEach(function (f) { f.call(this); }, this); if (${name}.__ctor) ${name}.__ctor.apply(this, arguments); }` +
      ` ${name}.__fields = []; ${name}.__ctor = null; ${name}.prototype.constructor = ${name};` +
      (outer ? ` ${outer}.${name} = ${name};` : ''));
    let k = open + 1;
    if (kind === 'enum') k = this.parseEnumConstants(k, close, cls);
    this.parseMembers(k, close, cls);
    this.emit(''); // the closing brace is dropped
    if (kind === 'enum') {
      this.emit(` ${name}.values = function () { return ${name}.__values.slice(); }; ${name}.valueOf = function (s) { return ${name}.__values.find(function (v) { return v.name === s; }); };`);
    }
    return close + 1;
  }

  parseEnumConstants(k, close, cls) {
    // NAME [(args)] [, NAME [(args)]]* [;]
    const name = cls.name;
    const consts = [];
    let i = k;
    while (i < close) {
      if (this.copyTrivia(i)) { i++; continue; }
      if (this.is(i, ';')) { i++; break; }
      if (this.is(i, ',')) { i++; continue; }
      if (this.tok(i).t === 'at') { i = this.parseAnnotation(i).end; continue; }
      if (this.tok(i).t === 'id') {
        const cname = this.tok(i).v;
        let args = '';
        let j = this.next(i);
        if (this.is(j, '(')) {
          const c2 = this.match[j];
          args = this.translateExpressionRange(j + 1, c2 - 1, { cls, locals: new Set(), rename: new Map(), intVars: new Set() });
          this.dropRange(j, c2);
          j = c2 + 1;
        }
        consts.push({ cname, args });
        i = j; continue;
      }
      // anything else means the constants are over
      break;
    }
    // constants are instantiated after members are defined (constructor may be later): defer to the end of the file
    this.emit(` ${name}.__values = [];`);
    // name/ordinal are callable (Java methods) but also behave as values so `"" + s.name` works
    const stmts = consts.map((c, ord) => `${name}.${c.cname} = (function () { var v = new ${name}(${c.args}); var n = ${JSON.stringify(c.cname)}; v.name = Object.assign(function () { return n; }, { toString: function () { return n; }, valueOf: function () { return n; } }); v.ordinal = Object.assign(function () { return ${ord}; }, { toString: function () { return '${ord}'; }, valueOf: function () { return ${ord}; } }); v.toString = function () { return n; }; v.compareTo = function (o) { return ${ord} - o.ordinal(); }; ${name}.__values.push(v); return v; })();`);
    // keep an eye on ordering: enum constants must exist before any code uses them, so link at end of file
    if (stmts.length) this.deferred = (this.deferred || []).concat(stmts);
    cls.enumConsts = consts;
    return i;
  }

  parseMembers(k, close, cls) {
    const name = cls.name;
    // first pass: collect field and method names for shadow-renaming
    this.collectMemberNames(k, close, cls);
    let i = k;
    let anns = [];
    let isStatic = false;
    while (i < close) {
      if (this.copyTrivia(i)) { i++; continue; }
      const tk = this.tok(i);
      if (tk.t === 'at') { const r = this.parseAnnotation(i); anns.push(r.ann); i = r.end; continue; }
      if (tk.t === 'kw' && MODIFIERS.has(tk.v)) { if (tk.v === 'static') isStatic = true; i++; continue; }
      if (this.is(i, ';')) { i++; continue; }
      if (tk.t === 'kw' && (tk.v === 'class' || tk.v === 'enum' || tk.v === 'interface')) {
        i = this.parseType(i, anns, name); anns = []; isStatic = false; continue;
      }
      if (this.is(i, '{')) { // initializer block
        const c2 = this.match[i];
        const ctx = this.newCtx(cls, [], i, c2);
        if (isStatic) { this.emit('(function () '); this.translateBlock(i, c2, ctx, false); this.emit(')();'); }
        else { this.emit(`${name}.__fields.push(function () `); this.translateBlock(i, c2, ctx, true); this.emit(');'); }
        i = c2 + 1; isStatic = false; anns = []; continue;
      }
      // generic method type parameters
      if (this.is(i, '<')) { const e = this.skipAngle(i); this.dropRange(i, e - 1); i = e; continue; }
      // constructor
      if (tk.t === 'id' && tk.v === name && this.is(this.next(i), '(')) {
        const p = this.next(i), pc = this.match[p];
        const params = this.readParams(p, pc);
        const b = this.next(pc); // may be `throws X {`
        const open = this.findBlockStart(b);
        const bc = this.match[open];
        const ctx = this.newCtx(cls, params, open, bc);
        this.dropRange(i, p - 1);
        this.emit(`${name}.__ctor = function (${params.map((x) => ctx.rename.get(x) || x).join(', ')})`);
        this.dropRange(p, open - 1);
        this.translateBlock(open, bc, ctx, true);
        this.emit(';');
        i = bc + 1; isStatic = false; anns = []; continue;
      }
      // method or field: read a type expression then a name
      const ty = this.readTypeExpr(i);
      if (!ty) { this.emit(tk.v); i++; continue; }
      const nameIdx = ty.end;
      const nm = this.tok(nameIdx);
      if (nm.t !== 'id') { this.emit(tk.v); i++; continue; }
      const after = this.next(nameIdx);
      if (this.is(after, '(')) {
        const pc = this.match[after];
        const params = this.readParams(after, pc);
        const b = this.next(pc);
        if (this.is(b, ';')) { // abstract / interface method
          this.dropRange(i, b); i = b + 1; isStatic = false; anns = []; continue;
        }
        const open = this.findBlockStart(b);
        const bc = this.match[open];
        const ctx = this.newCtx(cls, params, open, bc);
        this.dropRange(i, after - 1);
        const plist = params.map((x) => ctx.rename.get(x) || x).join(', ');
        if (isStatic) {
          this.emit(`function ${nm.v}(${plist})`);
          this.dropRange(after, open - 1);
          this.translateBlock(open, bc, ctx, false);
          this.emit(` ${name}.${nm.v} = ${nm.v};`);
        } else {
          this.emit(`${name}.prototype.${nm.v} = function (${plist})`);
          this.dropRange(after, open - 1);
          this.translateBlock(open, bc, ctx, true);
          this.emit(';');
        }
        i = bc + 1; isStatic = false; anns = []; continue;
      }
      // field declaration(s)
      i = this.parseFieldDecl(i, ty, cls, isStatic);
      isStatic = false; anns = [];
    }
  }

  collectMemberNames(k, close, cls) {
    let i = k;
    let isStatic = false;
    while (i < close) {
      if (!this.isSig(i)) { i++; continue; }
      const tk = this.tok(i);
      if (tk.t === 'at') { i = this.parseAnnotationSilently(i); continue; }
      if (tk.t === 'kw' && MODIFIERS.has(tk.v)) { if (tk.v === 'static') isStatic = true; i++; continue; }
      if (this.is(i, ';')) { i++; isStatic = false; continue; }
      if (tk.t === 'kw' && (tk.v === 'class' || tk.v === 'enum' || tk.v === 'interface')) {
        let j = i; while (!this.is(j, '{')) j = this.next(j);
        i = this.match[j] + 1; isStatic = false; continue;
      }
      if (this.is(i, '{')) { i = this.match[i] + 1; isStatic = false; continue; }
      if (this.is(i, '<')) { i = this.skipAngle(i); continue; }
      if (tk.t === 'id' && tk.v === cls.name && this.is(this.next(i), '(')) {
        const pc = this.match[this.next(i)];
        const open = this.findBlockStart(this.next(pc));
        i = this.match[open] + 1; isStatic = false; continue;
      }
      const ty = this.readTypeExpr(i);
      if (!ty) { i++; continue; }
      const nm = this.tok(ty.end);
      if (nm.t !== 'id') { i = ty.end + 1; continue; }
      const after = this.next(ty.end);
      if (this.is(after, '(')) {
        cls.methods.add(nm.v);
        const pc = this.match[after];
        const b = this.next(pc);
        if (this.is(b, ';')) { i = b + 1; } else { const open = this.findBlockStart(b); i = this.match[open] + 1; }
        isStatic = false; continue;
      }
      // fields
      let j = ty.end;
      while (j < close) {
        const fn = this.tok(j);
        if (fn.t === 'id') {
          if (isStatic) cls.methods.add(fn.v); // static fields become vars; treat as non-shadowable names
          else cls.fields.add(fn.v);
          if (INT_TYPES.has(ty.name) && !ty.array) cls.intFields.add(fn.v);
        }
        let e = this.next(j);
        while (this.is(e, '[')) e = this.next(this.match[e]);
        if (this.is(e, '=')) { e = this.skipExpr(this.next(e)); }
        if (this.is(e, ',')) { j = this.next(e); continue; }
        i = e + 1; break;
      }
      isStatic = false;
    }
  }

  parseAnnotationSilently(i) {
    const nameIdx = this.next(i);
    const p = this.next(nameIdx);
    if (this.is(p, '(')) return this.match[p] + 1;
    return nameIdx + 1;
  }

  /** Skip an expression up to (not including) the next `,` or `;` at depth 0. */
  skipExpr(i) {
    while (i < this.toks.length) {
      if (this.is(i, ',') || this.is(i, ';')) return i;
      if (this.is(i, '(') || this.is(i, '[') || this.is(i, '{')) { i = this.match[i] + 1; continue; }
      if (this.is(i, ')') || this.is(i, ']') || this.is(i, '}')) return i;
      i++;
    }
    return i;
  }

  parseFieldDecl(i, ty, cls, isStatic) {
    const name = cls.name;
    let j = ty.end;
    this.dropRange(i, j - 1);
    const ctx = this.newCtx(cls, [], j, j);
    let end = j;
    while (true) {
      const fn = this.tok(j).v;
      let e = this.next(j);
      let isArray = ty.array;
      while (this.is(e, '[')) { isArray = true; e = this.next(this.match[e]); }
      let init;
      if (this.is(e, '=')) {
        const s = this.next(e);
        const x = this.skipExpr(s);
        init = this.translateExpressionRange(s, x - 1, ctx, isArray);
        if (INT_TYPES.has(ty.name) && !isArray) init = `Math.trunc(${init})`;
        this.dropRange(j, x - 1);
        e = x;
      } else {
        init = defaultValue(ty.name, isArray);
        this.dropRange(j, e - 1);
      }
      if (isStatic) this.emit(`var ${fn} = ${init};`);
      else this.emit(`${name}.__fields.push(function () { with (this) { this.${fn} = ${init}; } });`);
      if (this.is(e, ',')) { j = this.next(e); continue; }
      end = e; // the `;`
      break;
    }
    return end + 1;
  }

  findBlockStart(b) {
    // skip `throws A, B` until `{`
    let j = b;
    while (j < this.toks.length && !this.is(j, '{')) j = this.next(j);
    return j;
  }

  skipAngle(i) {
    // i at '<' ; returns index after the matching '>' (handles >> and >>>)
    let depth = 0, j = i;
    while (j < this.toks.length) {
      const v = this.tok(j).v;
      if (v === '<') depth++;
      else if (v === '>') depth--;
      else if (v === '>>') depth -= 2;
      else if (v === '>>>') depth -= 3;
      j++;
      if (depth <= 0) break;
    }
    return j;
  }

  readTypeName(i) {
    // Identifier(.Identifier)*  -> {name, end}
    let j = i;
    let name = this.tok(j).v;
    let last = j;
    while (this.is(this.next(j), '.') && this.tok(this.next(this.next(j))).t === 'id') {
      j = this.next(this.next(j)); name += '.' + this.tok(j).v; last = j;
    }
    return { name, end: this.next(last) };
  }

  /**
   * Try to read a type expression at i: [final] (primitive | Name(.Name)*) [<...>] ([])*
   * Returns {name, array, end} where end is the index of the next significant token, or null.
   */
  readTypeExpr(i) {
    let j = i;
    if (this.is(j, 'final', 'kw')) j = this.next(j);
    const tk = this.tok(j);
    let name, array = false;
    if (tk.t === 'kw' && PRIMITIVES.has(tk.v)) { name = tk.v; j = this.next(j); }
    else if (tk.t === 'id') { const r = this.readTypeName(j); name = r.name; j = r.end; }
    else return null;
    if (this.is(j, '<')) j = this.skipAngleSig(j);
    while (this.is(j, '[') && this.is(this.next(j), ']')) { array = true; j = this.next(this.next(j)); }
    if (this.is(j, '...')) { j = this.next(j); array = true; }
    return { name, array, end: j };
  }

  skipAngleSig(i) { const e = this.skipAngle(i); let j = e; while (j < this.toks.length && !this.isSig(j)) j++; return j; }

  readParams(p, pc) {
    // (Type a, final Type b, Type... c) -> ['a','b','c']
    const names = [];
    let i = this.next(p);
    while (i < pc) {
      if (this.tok(i).t === 'at') { i = this.parseAnnotationSilently(i); continue; }
      const ty = this.readTypeExpr(i);
      if (!ty) { i = this.next(i); continue; }
      const nm = this.tok(ty.end);
      if (nm.t === 'id') names.push(nm.v);
      let e = this.next(ty.end);
      while (this.is(e, '[')) e = this.next(this.match[e]);
      if (this.is(e, ',')) i = this.next(e); else break;
    }
    return names;
  }

  // ---- method bodies -------------------------------------------------------------
  newCtx(cls, params, open, close) {
    const locals = new Set(params);
    const intVars = new Set();
    // pre-scan the body for local declarations to find names that shadow fields/methods
    this.scanLocals(open, close, locals, intVars);
    const shadowable = new Set([...cls.fields, ...cls.methods]);
    if (cls.base && ['LinearOpMode', 'OpMode'].includes(cls.base)) for (const n of SDK_INSTANCE_NAMES) shadowable.add(n);
    for (const c of this.classes) if (c.name === cls.base) for (const f of c.fields) shadowable.add(f);
    const rename = new Map();
    for (const l of locals) if (shadowable.has(l)) rename.set(l, `${l}$`);
    return { cls, locals, rename, intVars, params: new Set(params) };
  }

  scanLocals(open, close, locals, intVars) {
    let i = open + 1;
    while (i < close) {
      if (!this.isSig(i)) { i++; continue; }
      const p = this.prev(i);
      const pv = this.tok(p).v;
      const stmtStart = p < 0 || [';', '{', '}', ':', 'else', 'do', '('].includes(pv) || (this.tok(p).t === 'op' && pv === ')' && false);
      if (stmtStart && (this.tok(i).t === 'id' || (this.tok(i).t === 'kw' && (PRIMITIVES.has(this.tok(i).v) || this.tok(i).v === 'final')))) {
        // only count `(` starts when it belongs to for/catch
        if (pv === '(') { const pp = this.prev(p); if (!(this.is(pp, 'for', 'kw') || this.is(pp, 'catch', 'kw'))) { i++; continue; } }
        const ty = this.readTypeExpr(i);
        if (ty && this.tok(ty.end).t === 'id') {
          const after = this.next(ty.end);
          if ([ '=', ';', ',', ':', '[', ')' ].includes(this.tok(after).v) && !(this.tok(after).v === ')' && !this.is(this.prev(i), '('))) {
            let j = ty.end;
            while (true) {
              const nm = this.tok(j).v; locals.add(nm);
              if (INT_TYPES.has(ty.name) && !ty.array) intVars.add(nm);
              let e = this.next(j);
              while (this.is(e, '[')) e = this.next(this.match[e]);
              if (this.is(e, '=')) e = this.skipExpr(this.next(e));
              if (this.is(e, ',') && !this.is(ty.end, ')')) { j = this.next(e); if (this.tok(j).t !== 'id') break; continue; }
              break;
            }
          }
        }
      }
      i++;
    }
  }

  /** Translate the block starting at `open` (a `{`) through its matching `close`. */
  translateBlock(open, close, ctx, withThis) {
    this.emit('{');
    if (withThis) this.emit(' with (this) {');
    this.translateStatements(open + 1, close - 1, ctx);
    if (withThis) this.emit('}');
    this.emit('}');
  }

  translateExpressionRange(a, b, ctx, arrayInit = false) {
    const saved = this.out;
    this.out = [];
    this.translateStatements(a, b, ctx, arrayInit ? 'arrayInit' : 'expr');
    const s = this.out.join('').replace(/\n/g, ' ');
    this.out = saved;
    return s;
  }

  translateStatements(a, b, ctx, mode = 'stmt') {
    let i = a;
    const braceKinds = new Map(); // index of '{' -> 'array' | 'block'
    while (i <= b) {
      const tk = this.tok(i);
      if (this.copyTrivia(i)) { i++; continue; }
      const p = this.prev(i);
      const pv = p >= 0 ? this.tok(p).v : null;
      const pt = p >= 0 ? this.tok(p).t : null;

      // statement-start declaration:  Type name ...  ->  let name ...
      if (mode === 'stmt' && (tk.t === 'id' || (tk.t === 'kw' && (PRIMITIVES.has(tk.v) || tk.v === 'final')))) {
        const stmtStart = p < a || [';', '{', '}', ':', 'else', 'do'].includes(pv) ||
          (pv === '(' && (this.is(this.prev(p), 'for', 'kw')));
        if (stmtStart) {
          const ty = this.readTypeExpr(i);
          if (ty && this.tok(ty.end).t === 'id' && this.tok(ty.end).v !== 'instanceof') {
            const after = this.next(ty.end);
            const av = this.tok(after).v;
            if (['=', ';', ',', ':', '['].includes(av)) {
              // for-each?
              if (av === ':' ) {
                this.dropRange(i, ty.end - 1);
                const nm = this.tok(ty.end).v;
                this.emit(`let ${ctx.rename.get(nm) || nm}`);
                this.dropRange(ty.end + 1, after - 1);
                this.emit(' of');
                i = after + 1; continue;
              }
              this.dropRange(i, ty.end - 1);
              this.emit('let ');
              // declarators
              let j = ty.end;
              while (true) {
                const nm = this.tok(j).v;
                this.emit(ctx.rename.get(nm) || nm);
                let e = this.next(j);
                let isArray = ty.array;
                while (this.is(e, '[')) { isArray = true; e = this.next(this.match[e]); }
                if (this.is(e, '=')) {
                  const s = this.next(e);
                  const x = this.skipExpr(s);
                  const init = this.translateExpressionRange(s, x - 1, ctx, isArray);
                  this.dropRange(j + 1, x - 1);
                  this.emit(' = ' + (INT_TYPES.has(ty.name) && !isArray ? `Math.trunc(${init})` : init));
                  e = x;
                } else {
                  this.dropRange(j + 1, e - 1);
                  this.emit(' = ' + defaultValue(ty.name, isArray));
                }
                if (this.is(e, ',')) { this.emit(', '); j = this.next(e); if (this.tok(j).t !== 'id') { i = j; break; } continue; }
                i = e; break;
              }
              continue;
            }
          }
        }
      }

      // int-typed plain assignment: x = expr;  -> x = Math.trunc(expr)
      if (mode === 'stmt' && tk.t === 'id' && this.is(this.next(i), '=') && !this.is(this.next(this.next(i)), '=')) {
        const stmtStart = p < a || [';', '{', '}', ':', 'else', 'do'].includes(pv);
        const isInt = ctx.intVars.has(tk.v) || (ctx.cls.intFields.has(tk.v) && !ctx.locals.has(tk.v));
        if (stmtStart && isInt && !(pv === '.')) {
          const eq = this.next(i);
          const s = this.next(eq);
          const x = this.skipExpr(s);
          const rhs = this.translateExpressionRange(s, x - 1, ctx);
          this.emit(`${ctx.rename.get(tk.v) || tk.v} = Math.trunc(${rhs})`);
          this.dropRange(i + 1, x - 1);
          i = x; continue;
        }
      }

      if (tk.t === 'kw') {
        switch (tk.v) {
          case 'catch': {
            const p1 = this.next(i), pc = this.match[p1];
            // catch (A | B e) -> catch (e)
            let nm = this.prev(pc);
            this.emit('catch (' + (ctx.rename.get(this.tok(nm).v) || this.tok(nm).v) + ')');
            this.dropRange(i + 1, pc);
            i = pc + 1; continue;
          }
          case 'synchronized': {
            const p1 = this.next(i);
            if (this.is(p1, '(')) { const pc = this.match[p1]; this.dropRange(i, pc); i = pc + 1; continue; }
            i++; continue;
          }
          case 'assert': { const e = this.skipExpr(i); this.dropRange(i, e); i = e + 1; continue; }
          case 'final': i++; continue;
          case 'instanceof': this.emit(' instanceof '); i++; continue;
          case 'new': {
            i = this.translateNew(i, ctx); continue;
          }
          case 'super': {
            const nx = this.next(i);
            if (this.is(nx, '(')) { // super(args)
              const pc = this.match[nx];
              const args = this.translateExpressionRange(nx + 1, pc - 1, ctx);
              this.emit(`${ctx.cls.base}.apply(this, [${args}])`);
              this.dropRange(i, pc); i = pc + 1; continue;
            }
            if (this.is(nx, '.')) {
              const m = this.next(nx), p1 = this.next(m);
              if (this.is(p1, '(')) {
                const pc = this.match[p1];
                const args = this.translateExpressionRange(p1 + 1, pc - 1, ctx);
                this.emit(`${ctx.cls.base}.prototype.${this.tok(m).v}.apply(this, [${args}])`);
                this.dropRange(i, pc); i = pc + 1; continue;
              }
              this.emit(`${ctx.cls.base}.prototype.`); this.dropRange(i, nx); i = nx + 1; continue;
            }
            this.emit('super'); i++; continue;
          }
          case 'this': {
            const nx = this.next(i);
            if (this.is(nx, '(')) { // this(args) constructor chaining
              const pc = this.match[nx];
              const args = this.translateExpressionRange(nx + 1, pc - 1, ctx);
              this.emit(`${ctx.cls.name}.__ctor.apply(this, [${args}])`);
              this.dropRange(i, pc); i = pc + 1; continue;
            }
            this.emit('this'); i++; continue;
          }
          case 'try': {
            const nx = this.next(i);
            if (this.is(nx, '(')) { this.warn('try-with-resources is not supported; the resource is ignored', tk); const pc = this.match[nx]; this.emit('try'); this.dropRange(i + 1, pc); i = pc + 1; continue; }
            this.emit('try'); i++; continue;
          }
          case 'throws': { let j = i; while (!this.is(j, '{') && !this.is(j, ';')) j = this.next(j); this.dropRange(i, j - 1); i = j; continue; }
          default:
            this.emit(tk.v); i++; continue;
        }
      }

      if (tk.t === 'op') {
        // cast?
        if (tk.v === '(' && mode !== 'arrayInit') {
          const cast = this.tryCast(i, ctx);
          if (cast) { i = cast; continue; }
        }
        if (tk.v === '.' ) {
          const nx = this.next(i);
          if (this.is(nx, 'class', 'kw')) { this.dropRange(i, nx); i = nx + 1; continue; }        // Foo.class -> Foo
          if (this.is(nx, 'length', 'id') && this.is(this.next(nx), '(') && this.is(this.next(this.next(nx)), ')')) {
            this.emit('.length'); this.dropRange(i + 1, this.next(this.next(nx))); i = this.next(this.next(nx)) + 1; continue;
          }
          if (this.is(nx, '<')) { const e = this.skipAngle(nx); this.emit('.'); this.dropRange(i + 1, e - 1); i = e; continue; } // Foo.<T>bar()
        }
        if (tk.v === '->') { this.emit('=>'); i++; continue; }
        if (tk.v === '::') { this.warn('method references (::) are translated as property access', tk); this.emit('.'); i++; continue; }
        if (tk.v === '{') {
          const isArray = mode === 'arrayInit' && (p < a || pv === '=' || pv === ',' || pv === '{') || (mode !== 'arrayInit' && (pv === '=' || (braceKinds.get(this.match[this.findOpenBrace(i)]) === 'array' && (pv === ',' || pv === '{'))));
          if (isArray) { braceKinds.set(i, 'array'); this.emit('['); i++; continue; }
          braceKinds.set(i, 'block'); this.emit('{'); i++; continue;
        }
        if (tk.v === '}') {
          const o = this.match[i];
          if (braceKinds.get(o) === 'array') { this.emit(']'); i++; continue; }
          this.emit('}'); i++; continue;
        }
        this.emit(tk.v); i++; continue;
      }

      if (tk.t === 'id') {
        // identifier: rename shadowed locals when not a property access
        let v = tk.v;
        if (pv !== '.' && ctx.rename.has(v)) v = ctx.rename.get(v);
        else if (pv !== '.' && v === 'String' && this.is(this.next(i), '.') && this.is(this.next(this.next(i)), 'valueOf')) { /* fallthrough: String.valueOf handled by lang shim */ }
        this.emit(v); i++; continue;
      }
      if (tk.t === 'chr') { this.emit(tk.v); i++; continue; }
      if (tk.t === 'at') { i = this.parseAnnotation(i).end; continue; }
      this.emit(tk.v); i++;
    }
  }

  findOpenBrace(i) {
    // nearest enclosing '{' for token i
    let depth = 0;
    for (let j = i - 1; j >= 0; j--) {
      const v = this.tok(j).v;
      if (this.tok(j).t !== 'op') continue;
      if (v === '}') depth++;
      else if (v === '{') { if (depth === 0) return this.match[j]; depth--; }
    }
    return -1;
  }

  /** `(Type) operand` -> operand (or Math.trunc(operand) for integral casts). Returns new index or null. */
  tryCast(i, ctx) {
    const close = this.match[i];
    if (close < 0) return null;
    // contents must be a type expression only
    const first = this.next(i);
    const ty = this.readTypeExpr(first);
    if (!ty || ty.end !== close) return null;
    if (ty.name === 'final' || ty.name === 'var') return null;
    const p = this.prev(i);
    const pt = p >= 0 ? this.tok(p) : null;
    if (pt && (pt.t === 'id' || pt.t === 'num' || pt.t === 'str' || (pt.t === 'op' && (pt.v === ')' || pt.v === ']')) ||
      (pt.t === 'kw' && ['this', 'if', 'while', 'for', 'switch', 'catch', 'synchronized', 'super'].includes(pt.v)))) return null;
    const nx = this.next(close);
    const nt = this.tok(nx);
    const isPrimitive = PRIMITIVES.has(ty.name);
    const operandStart = nt.t === 'id' || nt.t === 'num' || nt.t === 'str' || nt.t === 'chr' ||
      (nt.t === 'kw' && ['this', 'new', 'super', 'true', 'false', 'null'].includes(nt.v)) ||
      (nt.t === 'op' && (nt.v === '(' || nt.v === '!' || nt.v === '~' || (isPrimitive && (nt.v === '-' || nt.v === '+'))));
    if (!operandStart) return null;
    if (!isPrimitive && nt.t === 'id' && false) return null;
    // find the operand extent
    const end = this.unaryOperandEnd(nx);
    const operand = this.translateExpressionRange(nx, end, ctx);
    this.dropRange(i, close);
    if (INT_TYPES.has(ty.name) || ty.name === 'char') this.emit(`Math.trunc(${operand})`);
    else this.emit(`(${operand})`);
    this.dropRange(nx, end);
    return end + 1;
  }

  /** Index of the last token of the unary/postfix expression starting at i. */
  unaryOperandEnd(i) {
    let j = i;
    const tk = this.tok(j);
    if (tk.t === 'op' && ['-', '+', '!', '~', '++', '--'].includes(tk.v)) return this.unaryOperandEnd(this.next(j));
    if (tk.t === 'op' && tk.v === '(') {
      const c = this.match[j];
      // is this itself a cast?  (Type) x
      const inner = this.readTypeExpr(this.next(j));
      if (inner && inner.end === c) {
        const nx = this.next(c);
        return this.unaryOperandEnd(nx);
      }
      j = c;
    } else if (tk.t === 'kw' && tk.v === 'new') {
      j = this.next(j); // type name
      const r = this.readTypeName(j); j = r.end - 1; while (!this.isSig(j)) j--;
      let nx = this.next(j);
      if (this.is(nx, '<')) { nx = this.skipAngleSig(nx); j = nx - 1; while (!this.isSig(j)) j--; nx = this.next(j); }
      if (this.is(nx, '(')) j = this.match[nx];
      while (this.is(this.next(j), '[')) { j = this.match[this.next(j)]; }
      if (this.is(this.next(j), '{')) j = this.match[this.next(j)];
    } else {
      // literal / identifier / this
    }
    // postfix chain
    while (true) {
      const nx = this.next(j);
      if (this.is(nx, '.')) { j = this.next(nx); continue; }
      if (this.is(nx, '(') || this.is(nx, '[')) { j = this.match[nx]; continue; }
      if (this.is(nx, '++') || this.is(nx, '--')) { j = nx; continue; }
      break;
    }
    return j;
  }

  translateNew(i, ctx) {
    // new Type<...>(args) | new Type[n] | new Type[]{...} | new Type(args) { anonymous }
    const tIdx = this.next(i);
    const r = this.readTypeName(tIdx);
    let j = r.end;
    let generic = false;
    if (this.is(j, '<')) { generic = true; j = this.skipAngleSig(j); }
    if (this.is(j, '[')) {
      // array creation
      const dims = [];
      let hasInit = false;
      let k = j;
      while (this.is(k, '[')) {
        const c = this.match[k];
        if (c === this.next(k)) dims.push(null); else dims.push(this.translateExpressionRange(k + 1, c - 1, ctx));
        k = this.next(c);
      }
      let expr;
      if (this.is(k, '{')) {
        const c = this.match[k];
        expr = this.translateExpressionRange(k, c, ctx, true);
        hasInit = true;
        k = c + 1;
      } else {
        const fill = defaultValue(r.name, false);
        const build = (d) => {
          if (d >= dims.length || dims[d] === null) return fill;
          if (d === dims.length - 1) return `new Array(${dims[d]}).fill(${fill})`;
          return `Array.from({ length: ${dims[d]} }, function () { return ${build(d + 1)}; })`;
        };
        expr = build(0);
      }
      this.emit(expr);
      this.dropRange(i, k - 1);
      return k;
    }
    // constructor call
    this.emit('new ' + r.name);
    this.dropRange(i, r.end - 1);
    if (generic) { this.dropRange(r.end, j - 1); }
    if (this.is(j, '(')) {
      const c = this.match[j];
      const args = this.translateExpressionRange(j + 1, c - 1, ctx);
      this.emit('(' + args + ')');
      this.dropRange(j, c);
      let k = c + 1;
      const nx = this.next(c);
      if (this.is(nx, '{')) {
        const bc = this.match[nx];
        this.warn(`anonymous inner class for ${r.name} is not supported; its body was ignored`, this.tok(nx));
        this.dropRange(nx, bc);
        k = bc + 1;
      }
      return k;
    }
    return j;
  }
}

function unquote(s) {
  if (!s) return null;
  s = s.trim();
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

function defaultValue(typeName, isArray) {
  if (isArray) return 'null';
  switch (typeName) {
    case 'int': case 'long': case 'short': case 'byte': case 'double': case 'float': return '0';
    case 'boolean': return 'false';
    case 'char': return "'\\0'";
    default: return 'null';
  }
}

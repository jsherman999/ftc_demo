// A small code editor: textarea + line-number gutter + error line marker.
// No dependencies so the app works offline in a classroom.

export class Editor {
  constructor(root) {
    this.root = root;
    root.classList.add('editor');
    this.gutter = document.createElement('div');
    this.gutter.className = 'editor-gutter';
    this.textarea = document.createElement('textarea');
    this.textarea.className = 'editor-text';
    this.textarea.spellcheck = false;
    this.textarea.setAttribute('autocapitalize', 'off');
    this.textarea.setAttribute('autocomplete', 'off');
    this.textarea.wrap = 'off';
    root.append(this.gutter, this.textarea);
    this.errorLine = null;
    this.onChange = null;
    this.textarea.addEventListener('input', () => { this.renderGutter(); if (this.onChange) this.onChange(); });
    this.textarea.addEventListener('scroll', () => { this.gutter.scrollTop = this.textarea.scrollTop; });
    this.textarea.addEventListener('keydown', (e) => this.onKey(e));
    this.renderGutter();
  }

  get value() { return this.textarea.value; }
  set value(v) { this.textarea.value = v; this.errorLine = null; this.renderGutter(); }

  onKey(e) {
    const ta = this.textarea;
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart, end = ta.selectionEnd;
      if (s !== end && ta.value.slice(s, end).includes('\n')) {
        // indent / outdent the selected lines
        const before = ta.value.slice(0, s), sel = ta.value.slice(s, end), after = ta.value.slice(end);
        const lineStart = before.lastIndexOf('\n') + 1;
        const block = ta.value.slice(lineStart, end);
        const changed = e.shiftKey ? block.replace(/^ {1,4}/gm, '') : block.replace(/^/gm, '    ');
        ta.value = ta.value.slice(0, lineStart) + changed + after;
        ta.selectionStart = lineStart; ta.selectionEnd = lineStart + changed.length;
      } else {
        ta.setRangeText('    ', s, end, 'end');
      }
      this.renderGutter(); if (this.onChange) this.onChange();
    } else if (e.key === 'Enter') {
      // keep the indentation of the current line, add one level after '{'
      e.preventDefault();
      const s = ta.selectionStart;
      const before = ta.value.slice(0, s);
      const line = before.slice(before.lastIndexOf('\n') + 1);
      const indent = (line.match(/^\s*/) || [''])[0] + (line.trimEnd().endsWith('{') ? '    ' : '');
      ta.setRangeText('\n' + indent, s, ta.selectionEnd, 'end');
      this.renderGutter(); if (this.onChange) this.onChange();
    }
  }

  renderGutter() {
    const lines = this.textarea.value.split('\n').length;
    const parts = [];
    for (let i = 1; i <= lines; i++) parts.push(`<div class="ln${i === this.errorLine ? ' err' : ''}">${i}</div>`);
    this.gutter.innerHTML = parts.join('');
    this.gutter.scrollTop = this.textarea.scrollTop;
  }

  markError(line) {
    this.errorLine = line;
    this.renderGutter();
    if (line) this.scrollToLine(line);
  }

  scrollToLine(line) {
    const lh = parseFloat(getComputedStyle(this.textarea).lineHeight) || 18;
    this.textarea.scrollTop = Math.max(0, (line - 6) * lh);
    const pos = this.textarea.value.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
    this.textarea.focus();
    this.textarea.setSelectionRange(pos, pos);
  }
}

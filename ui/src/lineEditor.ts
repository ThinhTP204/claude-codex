/**
 * Line editing for terminals without a PTY (Windows "basic" mode): history on ↑↓, ←→/Home/End/Delete,
 * Ctrl+A/E/U, Backspace in the middle of the line. Arrow keys arrive as escape sequences that a
 * pipe-driven shell would just print ("[A"), so they are handled here and never sent.
 * `write` draws on the terminal, `send` gets each finished line (or "\x03").
 */
export function lineEditor(write: (s: string) => void, send: (s: string) => void): (data: string) => void {
  let line = '';
  let pos = 0;
  const history: string[] = [];
  let hIdx = 0;
  const back = (n: number) => n > 0 && write(`\x1b[${n}D`);
  const replace = (next: string) => {
    back(pos);
    write(`${next}\x1b[K`);
    line = next;
    pos = [...next].length;
  };
  const chars = () => [...line];
  return (data: string) => {
    for (let i = 0; i < data.length; ) {
      const esc = data[i] === '\x1b' ? /^\x1b(?:\[[0-9;]*[A-Za-z~]|O[A-Za-z])/.exec(data.slice(i)) : null;
      if (esc) {
        i += esc[0].length;
        const k = esc[0];
        if (k.endsWith('A') || k.endsWith('B')) {
          // history
          if (!history.length) continue;
          hIdx = Math.max(0, Math.min(history.length, hIdx + (k.endsWith('A') ? -1 : 1)));
          replace(history[hIdx] ?? '');
        } else if (k.endsWith('D')) {
          if (pos > 0) (pos--, back(1));
        } else if (k.endsWith('C')) {
          if (pos < chars().length) (pos++, write('\x1b[1C'));
        } else if (k === '\x1b[H' || k === '\x1bOH' || k === '\x1b[1~') {
          back(pos);
          pos = 0;
        } else if (k === '\x1b[F' || k === '\x1bOF' || k === '\x1b[4~') {
          const n = chars().length - pos;
          if (n) write(`\x1b[${n}C`);
          pos = chars().length;
        } else if (k === '\x1b[3~') {
          const c = chars();
          if (pos < c.length) {
            c.splice(pos, 1);
            line = c.join('');
            const rest = c.slice(pos).join('');
            write(`${rest} `);
            back([...rest].length + 1);
          }
        }
        continue; // any other key sequence is ignored rather than echoed
      }
      const ch = [...data.slice(i)][0];
      i += ch.length;
      if (ch === '\r' || ch === '\n') {
        if (ch === '\n' && data[i - 2] === '\r') continue;
        write('\r\n');
        send(line + '\n');
        if (line.trim() && history[history.length - 1] !== line) history.push(line);
        if (history.length > 200) history.shift();
        hIdx = history.length;
        line = '';
        pos = 0;
      } else if (ch === '\x7f' || ch === '\b') {
        if (pos > 0) {
          const c = chars();
          c.splice(pos - 1, 1);
          line = c.join('');
          pos--;
          const rest = c.slice(pos).join('');
          write(`\b${rest} `);
          back([...rest].length + 1);
        }
      } else if (ch === '\x03') {
        line = '';
        pos = 0;
        send('\x03');
      } else if (ch === '\x01') {
        back(pos);
        pos = 0;
      } else if (ch === '\x05') {
        const n = chars().length - pos;
        if (n) write(`\x1b[${n}C`);
        pos = chars().length;
      } else if (ch === '\x15') {
        // Ctrl+U: clear the line
        replace('');
      } else if (ch >= ' ') {
        const c = chars();
        c.splice(pos, 0, ch);
        line = c.join('');
        const rest = c.slice(pos + 1).join('');
        write(ch + rest);
        back([...rest].length);
        pos++;
      }
    }
  };
}

export class FormaSyntaxError extends Error {
  constructor(message, line, column = 1) {
    super(`Line ${line}, column ${column}: ${message}`);
    this.name = 'FormaSyntaxError';
    this.line = line;
    this.column = column;
  }
}

export function parseArgs(raw, line, baseColumn) {
  const args = [];
  let i = 0;
  while (i < raw.length) {
    while (i < raw.length && /\s/.test(raw[i])) i++;
    if (i >= raw.length) break;

    const start = i;
    const quote = raw[i] === '"' || raw[i] === "'" ? raw[i] : null;
    if (quote) {
      i++;
      let value = '';
      let closed = false;
      while (i < raw.length) {
        const char = raw[i];
        if (char === '\\') {
          if (i + 1 >= raw.length) {
            throw new FormaSyntaxError('unfinished escape at end of quoted value.', line, baseColumn + i);
          }
          const next = raw[i + 1];
          value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          i += 2;
        } else if (char === quote) {
          closed = true;
          i++;
          break;
        } else {
          value += char;
          i++;
        }
      }
      if (!closed) {
        throw new FormaSyntaxError('unterminated quoted value.', line, baseColumn + start);
      }
      if (i < raw.length && !/\s/.test(raw[i])) {
        throw new FormaSyntaxError('expected a space after a quoted value.', line, baseColumn + i);
      }
      args.push(value);
    } else {
      while (i < raw.length && !/\s/.test(raw[i])) i++;
      args.push(raw.slice(start, i));
    }
  }
  return args;
}

export function parse(source) {
  if (typeof source !== 'string') throw new TypeError('Forma source must be a string.');
  const root = { name: '$root', args: [], children: [], line: 0, column: 1 };
  const stack = [{ indent: -1, node: root }];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;

    const leading = raw.match(/^[ \t]*/)[0];
    if (leading.includes('\t')) {
      throw new FormaSyntaxError('use spaces for indentation, not tabs.', i + 1, leading.indexOf('\t') + 1);
    }

    const indent = leading.length;
    if (indent % 2 !== 0) {
      throw new FormaSyntaxError('indentation must use multiples of two spaces.', i + 1, indent + 1);
    }
    if (stack.length === 1 && indent !== 0) {
      throw new FormaSyntaxError('top-level blocks must start at column 1 with no indentation.', i + 1, 1);
    }

    const content = raw.slice(indent);
    const match = content.match(/^([\w-]+)(?:\s+(.*))?$/);
    if (!match) throw new FormaSyntaxError(`could not parse '${content}'.`, i + 1, indent + 1);

    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    if (stack.length > 1 && indent > stack.at(-1).indent + 2) {
      throw new FormaSyntaxError('indentation jumped too far. Indent each nested block by exactly two spaces.', i + 1, indent + 1);
    }
    if (stack.length > 1 && indent > stack.at(-1).indent && indent !== stack.at(-1).indent + 2) {
      throw new FormaSyntaxError(`expected indentation of ${stack.at(-1).indent + 2} spaces for a child of '${stack.at(-1).node.name}'.`, i + 1, indent + 1);
    }

    const argsRaw = match[2] || '';
    const argsColumn = match[2] === undefined ? indent + match[1].length + 1 : indent + content.indexOf(match[2]) + 1;
    const node = {
      name: match[1],
      args: parseArgs(argsRaw, i + 1, argsColumn),
      children: [],
      line: i + 1,
      column: indent + 1,
    };
    stack.at(-1).node.children.push(node);
    stack.push({ indent, node });
  }

  return root;
}

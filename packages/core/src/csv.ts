/**
 * A small RFC 4180 CSV reader: quoted fields, doubled quotes, commas and line breaks
 * inside quotes, CRLF or LF line endings, and a leading byte-order mark. A quote in
 * the middle of an unquoted field is kept as text. Blank lines
 * are skipped. Each returned row keeps its 1-based line number in the file so errors
 * can point at it.
 */
export interface CsvRow {
  line: number;
  cells: string[];
}

export class CsvSyntaxError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`Line ${line}: ${message}`);
    this.name = 'CsvSyntaxError';
  }
}

export function parseCsv(text: string): CsvRow[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  let rowLine = 1;

  const endCell = () => {
    cells.push(cell);
    cell = '';
    afterQuote = false;
  };
  const endRow = () => {
    endCell();
    if (!(cells.length === 1 && cells[0]!.trim() === '')) rows.push({ line: rowLine, cells });
    cells = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && !afterQuote && cell.trim() === '') {
      // A quote at the start of a field opens a quoted field. Elsewhere in an unquoted
      // field it is kept as text, as spreadsheets do.
      cell = '';
      quoted = true;
    } else if (ch === ',') {
      endCell();
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      endRow();
      line++;
      rowLine = line;
    } else if (afterQuote) {
      if (ch !== ' ' && ch !== '\t') {
        throw new CsvSyntaxError('unexpected text after a closing quote.', line);
      }
    } else {
      cell += ch;
    }
  }
  if (quoted) throw new CsvSyntaxError('a quoted field is never closed.', rowLine);
  if (cell !== '' || cells.length > 0) endRow();
  return rows;
}

/** Normalizes a header cell: "Full Name" and "full_name" both become "full_name". */
export function csvHeaderKey(cell: string): string {
  return cell
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/** One CSV line from cells, quoting where needed. */
export function toCsvLine(
  cells: readonly (string | number | boolean | null | undefined)[],
): string {
  return cells
    .map((cell) => {
      const text = cell == null ? '' : String(cell);
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    })
    .join(',');
}

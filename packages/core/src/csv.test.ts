import { describe, expect, it } from 'vitest';
import { csvHeaderKey, CsvSyntaxError, parseCsv } from './csv';

describe('parseCsv', () => {
  it('reads plain rows with LF or CRLF endings and skips blank lines', () => {
    expect(parseCsv('a,b\r\n1,2\n\n3,4\n')).toEqual([
      { line: 1, cells: ['a', 'b'] },
      { line: 2, cells: ['1', '2'] },
      { line: 4, cells: ['3', '4'] },
    ]);
  });

  it('handles quotes, doubled quotes, commas and line breaks inside quotes', () => {
    const rows = parseCsv('name,note\n"Smith, Jane","She said ""yes""\nthen left"\nx,y');
    expect(rows[1]).toEqual({ line: 2, cells: ['Smith, Jane', 'She said "yes"\nthen left'] });
    expect(rows[2]).toEqual({ line: 4, cells: ['x', 'y'] });
  });

  it('keeps empty cells and strips a byte-order mark', () => {
    expect(parseCsv('﻿a,,c\n,,')).toEqual([
      { line: 1, cells: ['a', '', 'c'] },
      { line: 2, cells: ['', '', ''] },
    ]);
  });

  it('reads a last line with no line break', () => {
    expect(parseCsv('a\nb')).toEqual([
      { line: 1, cells: ['a'] },
      { line: 2, cells: ['b'] },
    ]);
  });

  it('rejects malformed quoting with the line number', () => {
    expect(() => parseCsv('a\n"open')).toThrow(CsvSyntaxError);
    expect(() => parseCsv('a\n"open')).toThrow(/Line 2/);
    expect(() => parseCsv('"a"b')).toThrow(/after a closing quote/);
  });
});

it('keeps a quote in the middle of an unquoted field as text', () => {
  expect(parseCsv('Jordan "JI" Import,x')[0]!.cells).toEqual(['Jordan "JI" Import', 'x']);
});

describe('csvHeaderKey', () => {
  it('normalizes headers', () => {
    expect(csvHeaderKey(' Full Name ')).toBe('full_name');
    expect(csvHeaderKey('FEC-Candidate-ID')).toBe('fec_candidate_id');
  });
});

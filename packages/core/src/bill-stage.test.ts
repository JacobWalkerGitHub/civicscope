import { describe, expect, it } from 'vitest';
import { billStage, congressOn, htmlToPlainText, memberDisplayName } from './congress';

describe('billStage', () => {
  const cases: [Parameters<typeof billStage>[0], string, string][] = [
    ['hr', 'Became Public Law No: 119-21.', 'law'],
    ['hr', 'Introduced in House', 'introduced'],
    ['hr', 'Referred to the House Committee on Ways and Means.', 'committee'],
    ['s', 'Read twice and referred to the Committee on Finance.', 'committee'],
    ['hr', 'Placed on the Union Calendar, Calendar No. 12.', 'reported'],
    ['hr', 'Received in the Senate.', 'passed_house'],
    [
      'hr',
      'Passed/agreed to in House: On passage Passed by the Yeas and Nays: 220 - 207.',
      'passed_house',
    ],
    [
      'hr',
      'Passed/agreed to in Senate: Passed Senate without amendment by Voice Vote.',
      'passed_both',
    ],
    [
      's',
      'Passed/agreed to in Senate: Passed Senate with an amendment by Unanimous Consent.',
      'passed_senate',
    ],
    ['hr', 'Presented to President.', 'passed_both'],
    ['hr', 'Vetoed by President.', 'vetoed'],
    ['hjres', 'Failed of passage in Senate over veto by Yea-Nay Vote. 60 - 39.', 'vetoed'],
    [
      'hr',
      'On motion to suspend the rules and pass the bill Failed by the Yeas and Nays: (2/3 required): 250 - 170.',
      'failed',
    ],
    [
      'hres',
      'Passed/agreed to in House: On agreeing to the resolution Agreed to by the Yeas and Nays: 216 - 210.',
      'adopted',
    ],
    [
      'sres',
      'Submitted in the Senate, considered, and agreed to without amendment by Unanimous Consent.',
      'adopted',
    ],
    [
      'hconres',
      'Passed/agreed to in Senate: Resolution agreed to in Senate by Unanimous Consent.',
      'adopted',
    ],
    ['hr', null as unknown as string, 'introduced'],
  ];
  it.each(cases)('%s "%s" is %s', (type, text, stage) => {
    expect(billStage(type, text)).toBe(stage);
  });
  it('trusts the laws list', () => {
    expect(billStage('hr', 'Signed by President.', { becameLaw: true })).toBe('law');
  });
});

describe('htmlToPlainText', () => {
  it('keeps paragraphs and list items, drops tags and decodes entities', () => {
    expect(
      htmlToPlainText(
        '<p><strong>Tax Relief Act</strong></p><p>This bill &ldquo;does&rdquo; A &amp; B:</p><ul><li>one</li><li>two<script>x</script></li></ul>',
      ),
    ).toBe('Tax Relief Act\n\nThis bill “does” A & B:\n\n• one\n\n• twox');
  });
  it('returns null for empty input', () => {
    expect(htmlToPlainText('<p> </p>')).toBeNull();
  });
});

describe('memberDisplayName and congressOn', () => {
  it('flips "Last, First"', () => {
    expect(memberDisplayName('Warren, Elizabeth')).toBe('Elizabeth Warren');
    expect(memberDisplayName('Cher')).toBe('Cher');
  });
  it('knows which Congress is sitting', () => {
    expect(congressOn('2026-11-04')).toBe(119);
    expect(congressOn('2025-01-02')).toBe(118);
    expect(congressOn('2027-01-03')).toBe(120);
  });
});

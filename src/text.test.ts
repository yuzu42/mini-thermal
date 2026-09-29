import { describe, expect, it } from 'vitest';
import { wrapText, textWrapped, divider, sanitize, DEFAULT_TRANSLITERATIONS } from './text';
import { text } from './commands';

describe('wrapText', () => {
  it('wraps at spaces within the width', () => {
    expect(wrapText('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc']);
  });

  it('keeps the line when words fit exactly', () => {
    expect(wrapText('four', 4)).toEqual(['four']);
  });

  it('breaks words longer than width at interior hyphens', () => {
    // 'Donaudampfschiff-fahrtsgesellschaft' @ width 12:
    // no hyphen within the first 12 chars → hard split; then
    // 'hiff-…' has a hyphen at index 4 → split after it; the rest
    // has no hyphen → hard split, remainder fits.
    expect(wrapText('Donaudampfschiff-fahrtsgesellschaft', 12)).toEqual([
      'Donaudampfsc',
      'hiff-',
      'fahrtsgesell',
      'schaft',
    ]);
  });

  it('splits after the last hyphen that fits', () => {
    expect(wrapText('sonnen-blume', 11)).toEqual(['sonnen-', 'blume']);
  });

  it('hard-splits unbreakable long words', () => {
    expect(wrapText('aaaaaaaaaaaa', 5)).toEqual(['aaaaa', 'aaaaa', 'aa']);
  });

  it('preserves existing newlines and blank lines', () => {
    expect(wrapText('a\n\nb', 32)).toEqual(['a', '', 'b']);
  });

  it('collapses runs of multiple spaces', () => {
    expect(wrapText('a    b', 32)).toEqual(['a b']);
  });

  it('emits empty lines for empty input', () => {
    expect(wrapText('', 32)).toEqual(['']);
  });

  it('splits each word of a long text across lines (integration)', () => {
    const lines = wrapText('lorem ipsum dolor sit amet consectetur adipiscing elit sed', 11);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(11);
    }
    expect(lines).toEqual([
      'lorem ipsum',
      'dolor sit',
      'amet',
      'consectetur',
      'adipiscing',
      'elit sed',
    ]);
  });
});

describe('textWrapped', () => {
  it('maps each wrapped line through text()', () => {
    const bufs = textWrapped('aaa bbb', 3);
    expect(bufs.map((b) => [...b])).toEqual([
      [...text('aaa')],
      [...text('bbb')],
    ]);
  });
});

describe('divider', () => {
  it('repeats the char to line width', () => {
    expect(divider()).toBe('-'.repeat(32));
    expect(divider('=', 10)).toBe('==========');
  });
});

describe('sanitize', () => {
  it('transliterates German umlauts and ß', () => {
    expect(sanitize('\u00e4 \u00f6 \u00fc \u00c4 \u00d6 \u00dc \u00df')).toBe('ae oe ue Ae Oe Ue ss');
    expect(sanitize('sch\u00f6ne Gr\u00fc\u00dfe')).toBe('schoene Gruesse');
  });

  it('leaves ASCII untouched', () => {
    expect(sanitize('Hello World 123!')).toBe('Hello World 123!');
  });

  it('accepts a custom map', () => {
    expect(sanitize('café', { é: 'e' })).toBe('cafe');
  });

  it('the default map matches the reference driver', () => {
    expect(DEFAULT_TRANSLITERATIONS).toEqual({
      ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss',
    });
  });
});
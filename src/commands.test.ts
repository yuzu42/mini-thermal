import { describe, expect, it } from 'vitest';
import { cmdInit, cmdJustify, cmdBold, cmdInverse, cmdDoubleHeight, cmdSize, cmdFeed, cmdPrintDensity, text, textNoNewline } from './commands';

describe('command builders (golden bytes)', () => {
  it('cmdInit is ESC @', () => {
    expect([...cmdInit()]).toEqual([0x1b, 0x40]);
  });

  it('cmdJustify maps L/C/R to 0/1/2', () => {
    expect([...cmdJustify('L')]).toEqual([0x1b, 0x61, 0x00]);
    expect([...cmdJustify('C')]).toEqual([0x1b, 0x61, 0x01]);
    expect([...cmdJustify('R')]).toEqual([0x1b, 0x61, 0x02]);
  });

  it('cmdBold toggles 1/0', () => {
    expect([...cmdBold(true)]).toEqual([0x1b, 0x45, 0x01]);
    expect([...cmdBold(false)]).toEqual([0x1b, 0x45, 0x00]);
  });

  it('cmdInverse is GS B n', () => {
    expect([...cmdInverse(true)]).toEqual([0x1d, 0x42, 0x01]);
  });

  it('cmdDoubleHeight sets/clears bit 4 of ESC !', () => {
    expect([...cmdDoubleHeight(true)]).toEqual([0x1b, 0x21, 0x10]);
    expect([...cmdDoubleHeight(false)]).toEqual([0x1b, 0x21, 0x00]);
  });

  it('cmdSize S/M/L', () => {
    expect([...cmdSize('S')]).toEqual([0x1d, 0x21, 0x00]);
    expect([...cmdSize('M')]).toEqual([0x1d, 0x21, 0x11]);
    expect([...cmdSize('L')]).toEqual([0x1d, 0x21, 0x22]);
  });

  it('cmdFeed sends ESC d n', () => {
    expect([...cmdFeed(4)]).toEqual([0x1b, 0x64, 0x04]);
  });

  it('cmdPrintDensity clamps and rounds', () => {
    expect([...cmdPrintDensity(15)]).toEqual([0x12, 0x23, 0x0f]);
    expect([...cmdPrintDensity(-5)]).toEqual([0x12, 0x23, 0x00]);
    expect([...cmdPrintDensity(999)]).toEqual([0x12, 0x23, 0x3f]);
    expect([...cmdPrintDensity(15.4)]).toEqual([0x12, 0x23, 0x0f]);
    expect([...cmdPrintDensity(15.5)]).toEqual([0x12, 0x23, 0x10]);
  });

  it('text encodes latin1 + newline', () => {
    expect([...text('AB')]).toEqual([0x41, 0x42, 0x0a]);
  });

  it('text truncates non-latin1 code points to one byte', () => {
    expect([...text('\u00e9')][0]).toBe(0xe9); // é fits latin1 directly
    expect([...text('\u20ac')][0]).toBe(0xac); // € (U+20AC) truncates to its low byte — garbage in, garbage out
  });

  it('textNoNewline omits the newline', () => {
    expect([...textNoNewline('AB')]).toEqual([0x41,  0x42]);
  });
});
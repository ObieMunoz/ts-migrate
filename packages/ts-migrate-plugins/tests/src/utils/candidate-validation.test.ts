import { toCandidatePos } from '../../../src/utils/candidateValidation';

describe('toCandidatePos', () => {
  const insertion = [{ start: 10, length: 0, text: '?' }];
  const replacement = [{ start: 10, length: 5, text: 'Props & { a?: string }' }];

  it('leaves a position before the change', () => {
    expect(toCandidatePos(4, insertion)).toBe(4);
    expect(toCandidatePos(4, replacement)).toBe(4);
  });

  it('shifts a position after the change', () => {
    expect(toCandidatePos(20, insertion)).toBe(21);
    expect(toCandidatePos(20, replacement)).toBe(37);
  });

  it('shifts a position at an insertion point', () => {
    expect(toCandidatePos(10, insertion)).toBe(11);
  });

  it('keeps the offset of a position inside a replaced span', () => {
    expect(toCandidatePos(10, replacement)).toBe(10);
    expect(toCandidatePos(13, replacement)).toBe(13);
  });

  it('adds up the changes that end before the position', () => {
    const changes = [
      { start: 2, length: 0, text: '??' },
      { start: 10, length: 5, text: 'Props & { a?: string }' },
      { start: 40, length: 0, text: '!' },
    ];
    expect(toCandidatePos(30, changes)).toBe(30 + 2 + 17);
  });
});

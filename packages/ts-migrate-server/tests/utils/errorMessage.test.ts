import errorMessage from '../../src/utils/errorMessage';

describe('errorMessage', () => {
  it('reads the message off an Error', () => {
    expect(errorMessage(new Error('could not read tsconfig.json'))).toBe(
      'could not read tsconfig.json',
    );
  });

  it('keeps the cause chain a message alone drops', () => {
    const root = new Error('EACCES: permission denied');
    const middle = new Error('could not read tsconfig.json', { cause: root });
    const top = new Error('migration failed', { cause: middle });

    expect(errorMessage(top)).toBe(
      'migration failed: could not read tsconfig.json: EACCES: permission denied',
    );
  });

  it('names the type of an Error carrying no message', () => {
    expect(errorMessage(new TypeError())).toBe('TypeError');
  });

  it('skips a link in the chain that has no message', () => {
    const root = new Error('EACCES: permission denied');
    const top = new Error('migration failed', { cause: new Error('', { cause: root }) });

    expect(errorMessage(top)).toBe('migration failed: EACCES: permission denied');
  });

  it('stops on a cause cycle', () => {
    const first = new Error('first');
    const second = new Error('second', { cause: first });
    first.cause = second;

    expect(errorMessage(second)).toBe('second: first');
  });

  it('renders values that are not Errors', () => {
    expect(errorMessage('plain string throw')).toBe('plain string throw');
    expect(errorMessage(undefined)).toBe('undefined');
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(404)).toBe('404');
  });

  it('ignores a cause that is not an Error', () => {
    expect(errorMessage(new Error('migration failed', { cause: 'a string' }))).toBe(
      'migration failed',
    );
  });
});

import { caseReader, mockPluginParams } from '../test-utils';
import stripTSIgnorePlugin from '../../src/plugins/strip-ts-ignore';

const readCase = caseReader('strip-ts-ignore');

describe('strip-ts-ignore plugin', () => {
  it('strips a suppression on the first line of a file', async () => {
    // At position 0 TypeScript reports the comment as both a leading and a
    // trailing range, so it was deleted twice; two deletes of one range are a
    // no-op, but they are overlapping updates and updateSourceText rejects
    // those now.
    const text = `// @ts-expect-error FIXME: no longer needed
const fine: number = 1;
`;

    const result = await stripTSIgnorePlugin.run(mockPluginParams({ text }));

    expect(result).toBe('const fine: number = 1;\n');
  });

  it('returns text without `// @ts-ignore`s', async () => {
    const text = readCase('ts-ignore-comments.input.tsx');

    const result = await stripTSIgnorePlugin.run(mockPluginParams({ text, fileName: 'Foo.tsx' }));

    expect(result).toBe(readCase('ts-ignore-comments.expected.tsx'));
  });

  it(`returns text without {/* @ts-ignores */}`, async () => {
    const text = `import React from 'react'
    import './App.css';


    const a:any = {}
    function App() {
      const fn = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'b' does not exist on type '{}'.
        console.log('ab', a.b)
      }
      return (
        <div className="App">
          <header className="App-header">
            <p>
      {/* @ts-expect-error ts-migrate(2339) FIXME: Property 'b' does not exist on type '{}'. */}
      Edit <code>src/App.js {a.b}</code> and save to reload.
            </p>
            <a
              className="App-link"
              href="https://reactjs.org"
              target="_blank"
              rel="noopener noreferrer"
            >

            </a>
          </header>
        </div>
      );
    }

    export default App;
    `;
    const result = await stripTSIgnorePlugin.run(mockPluginParams({ text, fileName: 'Foo.tsx' }));

    expect(result).toBe(`import React from 'react'
    import './App.css';


    const a:any = {}
    function App() {
      const fn = () => {
        console.log('ab', a.b)
      }
      return (
        <div className="App">
          <header className="App-header">
            <p>
      Edit <code>src/App.js {a.b}</code> and save to reload.
            </p>
            <a
              className="App-link"
              href="https://reactjs.org"
              target="_blank"
              rel="noopener noreferrer"
            >

            </a>
          </header>
        </div>
      );
    }

    export default App;
    `);
  });
});

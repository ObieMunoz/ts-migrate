import ts from 'typescript';
import {
  getNumComponentsInSourceFile,
  isReactSfcArrowFunction,
} from '../../../src/plugins/utils/react';

function getSourceFile(sourceText: string) {
  return ts.createSourceFile('file.tsx', sourceText, ts.ScriptTarget.Latest, true);
}

function detectVariableStatements(sourceText: string) {
  return getSourceFile(sourceText)
    .statements.filter(ts.isVariableStatement)
    .map((statement) => isReactSfcArrowFunction(statement));
}

describe('isReactSfcArrowFunction', () => {
  it('accepts memo, React.memo and memo wrapping forwardRef', () => {
    expect(
      detectVariableStatements(`
const A = memo((props) => <div />);
const B = React.memo((props) => <div />);
const C = memo(forwardRef((props, ref) => <div ref={ref} />));
const D = memo(memo((props) => <div />));
`),
    ).toEqual([true, true, true, true]);
  });

  it('accepts function expressions', () => {
    expect(
      detectVariableStatements(`
const A = function (props) { return <div />; };
const B = function Named(props) { return <div />; };
const C = memo(function (props) { return <div />; });
`),
    ).toEqual([true, true, true]);
  });

  it('rejects non-components and lookalike calls', () => {
    expect(
      detectVariableStatements(`
const a = memo((props) => <div />);
const B = useMemo(() => 1, []);
const C = memoize((props) => <div />);
const D = memo(someComponent);
const E = memo();
const F = function (a, b, c) { return a; };
`),
    ).toEqual([false, false, false, false, false, false]);
  });
});

describe('getNumComponentsInSourceFile', () => {
  it('counts memo-wrapped and function-expression components', () => {
    const sourceFile = getSourceFile(`
class A extends React.Component { render() {} }
function B(props) { return <div />; }
const C = (props) => <div />;
const D = memo((props) => <div />);
const E = React.memo(forwardRef((props, ref) => <div ref={ref} />));
const F = function (props) { return <div />; };
const g = memo((props) => <div />);
`);

    expect(getNumComponentsInSourceFile(sourceFile)).toBe(6);
  });
});

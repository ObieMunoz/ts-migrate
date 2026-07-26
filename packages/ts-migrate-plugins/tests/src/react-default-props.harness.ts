import ts from 'typescript';
import reactDefaultPropsPlugin from '../../src/plugins/react-default-props';
import { createTypeChecker, pluginRunner } from '../test-utils';

/** Every test migrates a .tsx file; each says only what it is about. */
export const run = pluginRunner(reactDefaultPropsPlugin, { fileName: 'file.tsx' });

const REACT_STUB = `declare namespace JSX {
  interface Element {}
  interface IntrinsicElements { [name: string]: any; }
}
declare module 'react' {
  const React: any;
  export default React;
  export const memo: any;
  export const forwardRef: any;
}`;

/** Compiles the given files in memory, against the react stub above. */
export const typeCheck = createTypeChecker({
  sharedFiles: { '/react-stub.d.ts': REACT_STUB },
  compilerOptions: { jsx: ts.JsxEmit.React },
});

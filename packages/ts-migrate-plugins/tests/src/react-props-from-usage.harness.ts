import { realPluginParams } from '../test-utils';
import reactPropsFromUsagePlugin from '../../src/plugins/react-props-from-usage';

/**
 * Params for the component file, with optional extra files visible to the
 * language service so the plugin can find the call sites it infers from.
 */
export async function run(
  text: string,
  extraFiles: Record<string, string> = {},
  options: Record<string, unknown> = {},
) {
  return runAs('Foo.tsx', text, extraFiles, options);
}

/** The same, for a test whose subject is the name of the file itself. */
export async function runAs(
  fileName: string,
  text: string,
  extraFiles: Record<string, string> = {},
  options: Record<string, unknown> = {},
) {
  return reactPropsFromUsagePlugin.run(
    await realPluginParams({
      fileName,
      text,
      options,
      compilerOptions: { jsx: 2 /* React */ },
      extraFiles,
    }),
  );
}

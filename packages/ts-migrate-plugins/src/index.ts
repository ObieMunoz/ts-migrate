import { Plugin as PluginType } from '@obiemunoz/ts-migrate-server';
import addConversionsPlugin from './plugins/add-conversions';
import declareMissingClassPropertiesPlugin from './plugins/declare-missing-class-properties';
import eslintFixPlugin from './plugins/eslint-fix';
import explicitAnyPlugin from './plugins/explicit-any';
import hoistArrowFunctionsPlugin from './plugins/hoist-arrow-functions';
import hoistClassStaticsPlugin from './plugins/hoist-class-statics';
import hoistDeclarationsPlugin from './plugins/hoist-declarations';
import inferTypesPlugin from './plugins/infer-types';
import jsDocPlugin from './plugins/jsdoc';
import memberAccessibilityPlugin from './plugins/member-accessibility';
import reactClassLifecycleMethodsPlugin from './plugins/react-class-lifecycle-methods';
import reactClassStatePlugin from './plugins/react-class-state';
import reactDefaultPropsPlugin from './plugins/react-default-props';
import reactInlineImportedPropTypesPlugin from './plugins/react-inline-imported-prop-types';
import reactPropsPlugin from './plugins/react-props';
import reactShapePlugin from './plugins/react-shape';
import stripTSIgnorePlugin from './plugins/strip-ts-ignore';
import tsIgnorePlugin from './plugins/ts-ignore';
import updateImportPathsPlugin, {
  collectModuleSpecifiers,
} from './plugins/update-import-paths';
import updateSourceText, {
  SourceTextUpdate as SourceTextUpdateType,
} from './utils/updateSourceText';
import {
  createTypesPackageDetector,
  formatTypesPackageReport,
  MODULE_DECLARATIONS_FILE,
  TypesPackageDetector as TypesPackageDetectorType,
  TypesPackageReport as TypesPackageReportType,
} from './utils/typesPackages';

export type Plugin<T = unknown> = PluginType<T>;
export type SourceTextUpdate = SourceTextUpdateType;
export type TypesPackageDetector = TypesPackageDetectorType;
export type TypesPackageReport = TypesPackageReportType;

export {
  addConversionsPlugin,
  declareMissingClassPropertiesPlugin,
  eslintFixPlugin,
  explicitAnyPlugin,
  hoistArrowFunctionsPlugin,
  hoistClassStaticsPlugin,
  hoistDeclarationsPlugin,
  inferTypesPlugin,
  jsDocPlugin,
  memberAccessibilityPlugin,
  reactClassLifecycleMethodsPlugin,
  reactClassStatePlugin,
  reactDefaultPropsPlugin,
  reactInlineImportedPropTypesPlugin,
  reactPropsPlugin,
  reactShapePlugin,
  stripTSIgnorePlugin,
  tsIgnorePlugin,
  updateImportPathsPlugin,
};

export {
  updateSourceText,
  createTypesPackageDetector,
  formatTypesPackageReport,
  collectModuleSpecifiers,
  MODULE_DECLARATIONS_FILE,
};

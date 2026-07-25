import { Plugin as PluginType } from '@obiemunoz/ts-migrate-server';
import addConversionsPlugin from './plugins/add-conversions';
import convertCommonjsPlugin from './plugins/convert-commonjs';
import declareEmptyObjectPropertiesPlugin from './plugins/declare-empty-object-properties';
import declareMissingClassPropertiesPlugin from './plugins/declare-missing-class-properties';
import eslintFixPlugin, { Options as EslintFixOptionsType } from './plugins/eslint-fix';
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
import reactHookTypesPlugin from './plugins/react-hook-types';
import reactInlineImportedPropTypesPlugin from './plugins/react-inline-imported-prop-types';
import reactPropsPlugin from './plugins/react-props';
import reactShapePlugin from './plugins/react-shape';
import stripTSIgnorePlugin from './plugins/strip-ts-ignore';
import tsIgnorePlugin from './plugins/ts-ignore';
import updateImportPathsPlugin, {
  collectModuleSpecifiers,
} from './plugins/update-import-paths';
import widenAnnotationsPlugin from './plugins/widen-annotations';
import updateSourceText, {
  SourceTextUpdate as SourceTextUpdateType,
} from './utils/updateSourceText';
import {
  createSuppressionExplainer,
  formatSuppressionReport,
  formatSuppressionSummary,
  SuppressionExplainer as SuppressionExplainerType,
  SuppressionReport as SuppressionReportType,
  SuppressionSite as SuppressionSiteType,
} from './utils/suppressionExplainer';
import {
  printType,
  DEFAULT_MAX_UNION_MEMBERS,
  PrintTypeOptions as PrintTypeOptionsType,
  PrintTypeResult as PrintTypeResultType,
  TypePrintRefusal as TypePrintRefusalType,
} from './utils/typePrinter';
import {
  createTypesPackageDetector,
  formatTypesPackageReport,
  MODULE_DECLARATIONS_FILE,
  TypesPackageDetector as TypesPackageDetectorType,
  TypesPackageReport as TypesPackageReportType,
} from './utils/typesPackages';

export type Plugin<T = unknown> = PluginType<T>;
export type EslintFixOptions = EslintFixOptionsType;
export type SourceTextUpdate = SourceTextUpdateType;
export type SuppressionExplainer = SuppressionExplainerType;
export type SuppressionReport = SuppressionReportType;
export type SuppressionSite = SuppressionSiteType;
export type TypesPackageDetector = TypesPackageDetectorType;
export type TypesPackageReport = TypesPackageReportType;
export type PrintTypeOptions = PrintTypeOptionsType;
export type PrintTypeResult = PrintTypeResultType;
export type TypePrintRefusal = TypePrintRefusalType;

export {
  addConversionsPlugin,
  convertCommonjsPlugin,
  declareEmptyObjectPropertiesPlugin,
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
  reactHookTypesPlugin,
  reactInlineImportedPropTypesPlugin,
  reactPropsPlugin,
  reactShapePlugin,
  stripTSIgnorePlugin,
  tsIgnorePlugin,
  updateImportPathsPlugin,
  widenAnnotationsPlugin,
};

export {
  printType,
  DEFAULT_MAX_UNION_MEMBERS,
  updateSourceText,
  createSuppressionExplainer,
  createTypesPackageDetector,
  formatSuppressionReport,
  formatSuppressionSummary,
  formatTypesPackageReport,
  collectModuleSpecifiers,
  MODULE_DECLARATIONS_FILE,
};

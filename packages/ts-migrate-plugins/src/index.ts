import { Plugin as PluginType } from '@obiemunoz/ts-migrate-server';
import addConversionsPlugin from './plugins/add-conversions';
import convertCommonjsPlugin from './plugins/convert-commonjs';
import declareEmptyObjectPropertiesPlugin from './plugins/declare-empty-object-properties';
import declareMissingClassPropertiesPlugin from './plugins/declare-missing-class-properties';
import eslintFixPlugin, {
  findGeneratedFileParseErrors,
  GeneratedFileParseError as GeneratedFileParseErrorType,
  Options as EslintFixOptionsType,
} from './plugins/eslint-fix';
import explicitAnyPlugin from './plugins/explicit-any';
import hoistArrowFunctionsPlugin from './plugins/hoist-arrow-functions';
import hoistClassStaticsPlugin from './plugins/hoist-class-statics';
import hoistDeclarationsPlugin from './plugins/hoist-declarations';
import inferTypesPlugin from './plugins/infer-types';
import jsDocPlugin from './plugins/jsdoc';
import memberAccessibilityPlugin from './plugins/member-accessibility';
import optionalParametersPlugin from './plugins/optional-parameters';
import reactClassLifecycleMethodsPlugin from './plugins/react-class-lifecycle-methods';
import reactClassStatePlugin from './plugins/react-class-state';
import reactDefaultPropsPlugin from './plugins/react-default-props';
import reactDestructuredPropsPlugin from './plugins/react-destructured-props';
import reactForwardedPropsPlugin from './plugins/react-forwarded-props';
import reactHookTypesPlugin from './plugins/react-hook-types';
import reactInlineImportedPropTypesPlugin from './plugins/react-inline-imported-prop-types';
import reactPassedPropsPlugin from './plugins/react-passed-props';
import reactPropsPlugin from './plugins/react-props';
import reactPropsFromUsagePlugin from './plugins/react-props-from-usage';
import reactShapePlugin from './plugins/react-shape';
import relaxParameterShapesPlugin from './plugins/relax-parameter-shapes';
import retryAnnotationsPlugin from './plugins/retry-annotations';
import retryConversionsPlugin from './plugins/retry-conversions';
import stripTSIgnorePlugin from './plugins/strip-ts-ignore';
import tsIgnorePlugin from './plugins/ts-ignore';
import updateImportPathsPlugin, {
  collectModuleSpecifiers,
} from './plugins/update-import-paths';
import widenAnnotationsPlugin from './plugins/widen-annotations';
import updateSourceText, {
  SourceTextUpdate as SourceTextUpdateType,
} from './utils/updateSourceText';
import { FOLLOW_UP_MARKER } from './utils/followUpMarker';
import {
  createGlobalDeclarations,
  formatGlobalDeclarationsReport,
  GLOBAL_DECLARATIONS_FILE,
  GlobalDeclarationsCollector as GlobalDeclarationsCollectorType,
  GlobalDeclarationsReport as GlobalDeclarationsReportType,
} from './utils/globalDeclarations';
import {
  createSuppressionExplainer,
  formatSuppressionReport,
  formatSuppressionSummary,
  SuppressionExplainer as SuppressionExplainerType,
  SuppressionReport as SuppressionReportType,
  SuppressionSite as SuppressionSiteType,
  UnresolvedTypeGroup as UnresolvedTypeGroupType,
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
  formatTypesPackagePreflight,
  formatTypesPackageReport,
  MODULE_DECLARATIONS_FILE,
  preflightTypesPackages,
  TypesPackageDetector as TypesPackageDetectorType,
  TypesPackagePreflight as TypesPackagePreflightType,
  TypesPackageReport as TypesPackageReportType,
  TypesPackageSuggestion as TypesPackageSuggestionType,
} from './utils/typesPackages';

export type Plugin<T = unknown> = PluginType<T>;
export type EslintFixOptions = EslintFixOptionsType;
export type GeneratedFileParseError = GeneratedFileParseErrorType;
export type GlobalDeclarationsCollector = GlobalDeclarationsCollectorType;
export type GlobalDeclarationsReport = GlobalDeclarationsReportType;
export type SourceTextUpdate = SourceTextUpdateType;
export type SuppressionExplainer = SuppressionExplainerType;
export type SuppressionReport = SuppressionReportType;
export type SuppressionSite = SuppressionSiteType;
export type UnresolvedTypeGroup = UnresolvedTypeGroupType;
export type TypesPackageDetector = TypesPackageDetectorType;
export type TypesPackagePreflight = TypesPackagePreflightType;
export type TypesPackageReport = TypesPackageReportType;
export type TypesPackageSuggestion = TypesPackageSuggestionType;
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
  optionalParametersPlugin,
  reactClassLifecycleMethodsPlugin,
  reactClassStatePlugin,
  reactDefaultPropsPlugin,
  reactDestructuredPropsPlugin,
  reactForwardedPropsPlugin,
  reactHookTypesPlugin,
  reactInlineImportedPropTypesPlugin,
  reactPassedPropsPlugin,
  reactPropsPlugin,
  reactPropsFromUsagePlugin,
  reactShapePlugin,
  relaxParameterShapesPlugin,
  retryAnnotationsPlugin,
  retryConversionsPlugin,
  stripTSIgnorePlugin,
  tsIgnorePlugin,
  updateImportPathsPlugin,
  widenAnnotationsPlugin,
};

export {
  printType,
  DEFAULT_MAX_UNION_MEMBERS,
  updateSourceText,
  createGlobalDeclarations,
  createSuppressionExplainer,
  createTypesPackageDetector,
  formatGlobalDeclarationsReport,
  formatSuppressionReport,
  formatSuppressionSummary,
  formatTypesPackagePreflight,
  formatTypesPackageReport,
  findGeneratedFileParseErrors,
  collectModuleSpecifiers,
  preflightTypesPackages,
  FOLLOW_UP_MARKER,
  GLOBAL_DECLARATIONS_FILE,
  MODULE_DECLARATIONS_FILE,
};

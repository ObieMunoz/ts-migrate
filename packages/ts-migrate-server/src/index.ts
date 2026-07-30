import migrate, { MigrateConfig } from './migrate';
import PluginOptionsError from './utils/PluginOptionsError';
import errorMessage from './utils/errorMessage';
import fileNoticeReporter from './utils/fileNoticeReporter';
import { Plugin as PluginType, PluginParams as Params } from '../types';

export type Plugin<T = unknown> = PluginType<T>;
export type PluginParams<TPluginOptions = unknown> = Params<TPluginOptions>;
export type { ModuleResolution, PluginFileNotice } from '../types';
export type { EmptyMigrationSetReason, MigrateResult } from './migrate';

export { migrate, MigrateConfig, PluginOptionsError, errorMessage, fileNoticeReporter };

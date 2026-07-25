import migrate, { MigrateConfig } from './migrate';
import PluginOptionsError from './utils/PluginOptionsError';
import fileNoticeReporter from './utils/fileNoticeReporter';
import { Plugin as PluginType, PluginParams as Params } from '../types';

export type Plugin<T = unknown> = PluginType<T>;
export type PluginParams<TPluginOptions = unknown> = Params<TPluginOptions>;
export type { PluginFileNotice } from '../types';
export type { MigrateResult } from './migrate';

export { migrate, MigrateConfig, PluginOptionsError, fileNoticeReporter };

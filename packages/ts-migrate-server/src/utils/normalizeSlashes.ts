import path from 'path';

/**
 * A path with forward slashes, whatever separator the platform uses. The
 * overlay, the import graph and the reported-notice set are all keyed by this
 * form, so they have to normalize the same way to find each other's entries.
 */
export default function normalizeSlashes(fileName: string): string {
  return fileName.split(path.sep).join('/');
}

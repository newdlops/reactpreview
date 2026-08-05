/* eslint-disable jsdoc/require-jsdoc, @typescript-eslint/explicit-function-return-type */
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { PreviewFrontierMismatchEvidence } from '../../../domain/previewBuildExecution';
import { canonicalizeExistingPath } from '../../../shared/pathIdentity';
type Options = { readonly workspaceRoot: string; readonly sourcePath: string } & (
  | {
      readonly cause: 'guard-escape';
      readonly importerPath: string;
      readonly moduleSpecifier: string;
    }
  | {
      readonly cause: 'unexpected-metafile-input';
      readonly importerPath?: string;
      readonly moduleSpecifier?: string;
    }
  | {
      readonly cause: 'missing-execution-surface';
      readonly surfaceId: string;
      readonly surfaceStrategy: string;
    }
);
const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);
const safePath = (value: string) =>
  value.length > 0 &&
  value.length <= 512 &&
  !/[\\\x00-\x1f\x7f]/u.test(value) &&
  value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
function pathEvidence(root: string, source: string) {
  const canonical = canonicalizeExistingPath(source);
  const relative = path
    .relative(canonicalizeExistingPath(root), canonical)
    .split(path.sep)
    .join('/');
  const readable =
    !relative.startsWith('../') && relative !== '..' && safePath(relative) ? relative : undefined;
  return Object.freeze({
    digest: digest(readable ?? canonical),
    ...(readable === undefined ? {} : { workspaceRelativePath: readable }),
  });
}
export function createPreviewInspectorFrontierMismatchEvidence(
  options: Options,
): PreviewFrontierMismatchEvidence {
  const source = pathEvidence(options.workspaceRoot, options.sourcePath);
  if (options.cause === 'unexpected-metafile-input') {
    if (options.importerPath === undefined || options.moduleSpecifier === undefined)
      return Object.freeze({ cause: options.cause, source });
    const value = options.moduleSpecifier;
    const safe =
      value.length > 0 &&
      value.length <= 256 &&
      !/[\\\x00-\x1f\x7f]/u.test(value) &&
      !/^(?:\/|[A-Za-z]:[\\/]|[A-Za-z][A-Za-z0-9+.-]*:)/u.test(value);
    return Object.freeze({
      cause: options.cause,
      source,
      importer: pathEvidence(options.workspaceRoot, options.importerPath),
      specifier: Object.freeze({ digest: digest(value), ...(safe ? { value } : {}) }),
    });
  }
  if (options.cause === 'missing-execution-surface')
    return Object.freeze({
      cause: options.cause,
      source,
      surface: Object.freeze({
        identityDigest: digest(options.surfaceId),
        strategy: /^[a-z][a-z0-9-]{0,63}$/u.test(options.surfaceStrategy)
          ? options.surfaceStrategy
          : 'unknown',
      }),
    });
  const value = options.moduleSpecifier;
  const safe =
    value.length > 0 &&
    value.length <= 256 &&
    !/[\\\x00-\x1f\x7f]/u.test(value) &&
    !/^(?:\/|[A-Za-z]:[\\/]|[A-Za-z][A-Za-z0-9+.-]*:)/u.test(value);
  return Object.freeze({
    cause: options.cause,
    source,
    importer: pathEvidence(options.workspaceRoot, options.importerPath),
    specifier: Object.freeze({ digest: digest(value), ...(safe ? { value } : {}) }),
  });
}

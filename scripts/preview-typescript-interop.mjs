/** Shares TypeScript's default-import wrapper inside owned Node bundles, never authored preview code. */
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const TYPESCRIPT_PATH = require.resolve('typescript');
const NAMESPACE = 'react-preview-shared-typescript';

/**
 * Redirects only owned source-file ESM imports through one private default-export facade.
 * Hundreds of independent CJS-to-ESM wrappers otherwise enumerate TypeScript's entire API during
 * worker activation. The real package is still bundled once, with its identity and lazy init intact.
 * Third-party imports, subpaths, require calls, and browser preview builds are left untouched.
 * Named imports deliberately fail at build time rather than silently changing their semantics.
 *
 * @param {string} sourceRoot Absolute owned source directory, overridable only for build tests.
 * @returns {import('esbuild').Plugin} Node-bundle-only default import deduplication plugin.
 */
export function createPreviewTypeScriptInteropPlugin(sourceRoot = path.resolve('src')) {
  const boundary = path.resolve(sourceRoot);
  return {
    name: 'preview-typescript-interop',
    setup(build) {
      build.onResolve({ filter: /^typescript$/, namespace: 'file' }, (args) => {
        const relative = path.relative(boundary, args.importer);
        if (
          args.kind !== 'import-statement' ||
          relative === '' ||
          relative.split(path.sep).includes('node_modules') ||
          path.isAbsolute(relative) ||
          relative === '..' ||
          relative.startsWith(`..${path.sep}`)
        ) {
          return undefined;
        }
        return { path: 'typescript', namespace: NAMESPACE };
      });
      build.onLoad({ filter: /^typescript$/, namespace: NAMESPACE }, () => ({
        contents: `import ts from ${JSON.stringify(TYPESCRIPT_PATH)}; export default ts;`,
        loader: 'js',
        resolveDir: path.dirname(TYPESCRIPT_PATH),
      }));
    },
  };
}

/** Keeps an installed next-themes provider's preferences local to its project in shared webviews. */
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { OnLoadResult, Plugin } from 'esbuild';
import { isFileBackedPreviewNamespace, PREVIEW_RESOLVE_GUARD } from './previewPluginProtocol';

const SUFFIX = '?react-preview-project-theme-storage';
const DATA_KIND = 'react-preview-project-theme-storage';

/**
 * Wraps only an installed next-themes entry, retaining its real provider, hooks and authored props.
 * Namespacing storageKey avoids adopting an unrelated project's preference without clearing data.
 */
export function createPreviewNextThemesStoragePlugin(projectRoot: string): Plugin {
  const prefix = createPreviewNextThemesStoragePrefix(projectRoot);
  return {
    name: 'react-preview-next-themes-storage',
    setup(build): void {
      build.onResolve({ filter: /^next-themes$/ }, async (args) => {
        if (
          (args.pluginData as unknown) === PREVIEW_RESOLVE_GUARD ||
          (args.namespace !== 'file' && !isFileBackedPreviewNamespace(args.namespace))
        ) {
          return undefined;
        }
        const resolved = await build.resolve(args.path, {
          importer: args.importer,
          kind: args.kind,
          namespace: 'file',
          pluginData: PREVIEW_RESOLVE_GUARD,
          resolveDir: args.resolveDir,
          with: args.with,
        });
        if (resolved.errors.length > 0 || resolved.external || resolved.namespace !== 'file') {
          return undefined;
        }
        return {
          path: resolved.path,
          namespace: 'file',
          suffix: SUFFIX,
          pluginData: { kind: DATA_KIND },
          warnings: resolved.warnings,
        };
      });
      build.onLoad({ filter: /./, namespace: 'file' }, (args): OnLoadResult | undefined => {
        if (args.suffix !== SUFFIX) return undefined;
        const data: unknown = args.pluginData;
        if (
          typeof data !== 'object' ||
          data === null ||
          !('kind' in data) ||
          data.kind !== DATA_KIND
        ) {
          return undefined;
        }
        const original = JSON.stringify(args.path.replaceAll('\\', '/'));
        return {
          contents: [
            `import { createElement } from 'react';`,
            `import { ThemeProvider as AuthoredThemeProvider } from ${original};`,
            `export * from ${original};`,
            '/** Leaves theme selection to the authored provider with one project-owned key. */',
            'export function ThemeProvider(props) {',
            "  const authoredKey = typeof props.storageKey === 'string' ? props.storageKey : 'theme';",
            '  return createElement(AuthoredThemeProvider, {',
            `    ...props, storageKey: ${JSON.stringify(prefix)} + authoredKey,`,
            '  });',
            '}',
          ].join('\n'),
          loader: 'js',
          resolveDir: path.dirname(args.path),
          watchFiles: [args.path],
        };
      });
    },
  };
}

/** Returns a stable, path-free storage prefix shared by all pages of one canonical project. */
export function createPreviewNextThemesStoragePrefix(projectRoot: string): string {
  const key = createHash('sha256').update(path.resolve(projectRoot)).digest('hex').slice(0, 24);
  return `react-preview:project:${key}:next-themes:`;
}

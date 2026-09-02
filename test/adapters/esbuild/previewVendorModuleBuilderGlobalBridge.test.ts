/** Verifies vendor facades do not pre-initialize application wrappers against private copies. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Metafile } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewGlobalPackageBridgePlan } from '../../../src/adapters/esbuild/globalPackageBridge';
import { PreviewVendorModuleBuilder } from '../../../src/adapters/esbuild/previewVendorModuleBuilder';
import type { PreviewBundle } from '../../../src/domain/preview';

const PLUGIN_SPECIFIER = 'preview-stateful-runtime/plugin';

describe('PreviewVendorModuleBuilder global bridges', () => {
  /** Avoids running a project wrapper while building one of the wrapper's vendor dependencies. */
  it('keeps stateful plugin installation in the application module graph', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'preview-vendor-global-cycle-'));
    const projectRoot = path.join(workspaceRoot, 'application');
    const sourceRoot = path.join(projectRoot, 'src');
    const wrapperPath = path.join(sourceRoot, 'runtime-wrapper.js');
    const packageRoot = path.join(projectRoot, 'node_modules', 'preview-stateful-runtime');
    const outputRoot = path.join(workspaceRoot, 'rendered-vendor');
    const applicationSource = `import plugin from ${JSON.stringify(PLUGIN_SPECIFIER)}; void plugin;`;
    try {
      await Promise.all([
        mkdir(sourceRoot, { recursive: true }),
        mkdir(packageRoot, { recursive: true }),
        mkdir(outputRoot, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(path.join(workspaceRoot, 'package.json'), '{"type":"module"}', 'utf8'),
        writeFile(
          path.join(packageRoot, 'package.json'),
          '{"name":"preview-stateful-runtime","type":"module","exports":{"./plugin":"./plugin.js"}}',
          'utf8',
        ),
        writeFile(
          path.join(packageRoot, 'plugin.js'),
          [
            'const plugin = () => undefined;',
            'export const readRuntimeLater = () => previewRuntime;',
            'export default plugin;',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          wrapperPath,
          [
            `import plugin from ${JSON.stringify(PLUGIN_SPECIFIER)};`,
            'plugin.installed = true;',
            'export default () => undefined;',
          ].join('\n'),
          'utf8',
        ),
      ]);
      const globalPackagePlan = createPreviewGlobalPackageBridgePlan({
        candidates: [
          {
            evidence: 'runtime-assignment',
            exportKind: 'default',
            globalName: 'previewRuntime',
            moduleSpecifier: wrapperPath,
            resolveDir: sourceRoot,
            watchPath: wrapperPath,
          },
        ],
      });
      const bundle = await new PreviewVendorModuleBuilder().prepare({
        bundle: createApplicationBundle(applicationSource),
        globalPackagePlan,
        metafile: createApplicationMetafile(applicationSource, wrapperPath, workspaceRoot),
        nodePaths: [],
        projectRoot,
        workspaceRoot,
      });
      await Promise.all(
        bundle.chunks.map(async (chunk) => {
          const outputPath = path.join(outputRoot, chunk.relativePath);
          await mkdir(path.dirname(outputPath), { recursive: true });
          await writeFile(outputPath, chunk.contents);
        }),
      );
      const moduleEntry = bundle.moduleImports?.find(
        (moduleImport) => moduleImport.specifier === PLUGIN_SPECIFIER,
      );
      expect(moduleEntry).toBeDefined();
      const pluginModule = (await import(
        pathToFileURL(path.join(outputRoot, moduleEntry?.relativePath ?? '')).href
      )) as { readonly default: { readonly installed?: boolean } };

      expect(pluginModule.default.installed).toBeUndefined();
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});

/** Creates the application artifact whose external import becomes one vendor demand. */
function createApplicationBundle(source: string): PreviewBundle {
  return {
    chunks: [],
    dependencies: [],
    diagnostics: [],
    javascript: new TextEncoder().encode(source),
    watchDirectories: [],
  };
}

/** Retains the project wrapper as the primary-build importer of that same vendor demand. */
function createApplicationMetafile(
  source: string,
  wrapperPath: string,
  workspaceRoot: string,
): Metafile {
  const externalImport = {
    external: true,
    kind: 'import-statement' as const,
    path: PLUGIN_SPECIFIER,
  };
  return {
    inputs: {
      [path.relative(workspaceRoot, wrapperPath)]: {
        bytes: source.length,
        imports: [externalImport],
      },
    },
    outputs: {
      'entry.js': {
        bytes: source.length,
        exports: [],
        imports: [externalImport],
        inputs: {},
      },
    },
  };
}

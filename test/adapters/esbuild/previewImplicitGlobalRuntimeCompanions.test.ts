import { describe, expect, it } from 'vitest';
import {
  collectPreviewImplicitGlobalRuntimeCompanionPaths,
  collectPreviewInspectorRuntimeCompanionPaths,
} from '../../../src/adapters/esbuild/previewImplicitGlobalRuntimeCompanions';

describe('collectPreviewImplicitGlobalRuntimeCompanionPaths', () => {
  it('keeps only absolute runtime bridge modules out of broader evidence/watch paths', () => {
    const paths = collectPreviewImplicitGlobalRuntimeCompanionPaths({
      blockedGlobalNames: [],
      disableDependencyFallback: false,
      evidenceDependencyPaths: ['/workspace/App.tsx', '/workspace/runtime.ts'],
      hints: [
        { globalName: 'Runtime', moduleSpecifier: '/workspace/runtime.ts' },
        { globalName: 'Package', moduleSpecifier: 'package-runtime' },
        { globalName: 'Legacy', packageSpecifier: 'legacy-package' },
      ],
    });

    expect(paths).toEqual(['/workspace/runtime.ts']);
  });

  it('includes a resolved authored theme imported by the generated Inspector root', () => {
    const paths = collectPreviewInspectorRuntimeCompanionPaths({
      globalBridgePolicy: {
        blockedGlobalNames: [],
        disableDependencyFallback: false,
        evidenceDependencyPaths: [],
        hints: [{ globalName: 'Runtime', moduleSpecifier: '/workspace/runtime.ts' }],
      },
      globalStyleImports: [
        { exportName: 'GlobalStyle', moduleSpecifier: '/workspace/global-style.tsx' },
      ],
      resolveModule: (specifier, importer) =>
        specifier === './theme' && importer === '/workspace/Target.tsx'
          ? '/workspace/theme.ts'
          : undefined,
      themeImport: { exportName: 'theme', moduleSpecifier: './theme' },
      themeImporterPath: '/workspace/Target.tsx',
    });

    expect(paths).toEqual([
      '/workspace/global-style.tsx',
      '/workspace/runtime.ts',
      '/workspace/theme.ts',
    ]);
  });
});

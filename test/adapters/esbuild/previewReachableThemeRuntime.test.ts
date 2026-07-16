/**
 * Exercises reachable-theme registration through transformed child modules and the real bridge.
 * Temporary projects prove candidate modules remain behind deferred imports while the fake
 * styled-components package keeps the fixture independent from a particular library release.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createContext, runInContext, type Context } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewThemeBridgePlugin } from '../../../src/adapters/esbuild/previewThemeBridgePlugin';
import { createPreviewThemeCandidatePlugin } from '../../../src/adapters/esbuild/previewThemeCandidatePlugin';
import { PreviewSourceTransformer } from '../../../src/adapters/esbuild/staticResources/previewSourceTransformer';
import { createWorkspaceSourcePlugin } from '../../../src/adapters/esbuild/workspaceSourcePlugin';
import { installFakeStyledComponentsPackage } from './support/fakeStyledComponentsPackage';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('reachable theme runtime registration', () => {
  /**
   * Registers a child's erased theme reference without evaluating the candidate until resolution.
   */
  it('loads one type-only child theme lazily and returns its exact runtime export', async () => {
    const projectRoot = await createTemporaryProject('reachable-type-theme-preview-');

    try {
      await installFakeStyledComponentsPackage(projectRoot);
      await writeProjectFiles(projectRoot, {
        'child.tsx': [
          "import styled from 'styled-components';",
          "import type { theme } from './theme';",
          'export const Child = styled.div``;',
        ].join('\n'),
        'theme.ts': [
          'globalThis.__typeThemeEvaluations =',
          '  (globalThis.__typeThemeEvaluations ?? 0) + 1;',
          'export const theme = {',
          "  marker: 'TYPE_ONLY_THEME',",
          "  spacing: (factor) => factor * 4 + 'px',",
          '};',
        ].join('\n'),
      });

      const context = await executeReachableThemeFixture(
        projectRoot,
        [
          "import './child';",
          "import { resolvePreviewTheme } from 'react-preview:theme';",
          'globalThis.__beforeThemeResolution = globalThis.__typeThemeEvaluations ?? 0;',
          'const themeResolution = resolvePreviewTheme({});',
          'globalThis.__afterThemeResolutionCall = globalThis.__typeThemeEvaluations ?? 0;',
          'globalThis.__previewCompletion = themeResolution.then((theme) => {',
          '  globalThis.__resolvedThemeResult = {',
          '    evaluations: globalThis.__typeThemeEvaluations ?? 0,',
          '    marker: theme?.marker,',
          '    spacing: theme?.spacing(3),',
          '  };',
          '});',
        ].join('\n'),
      );

      expect(context.__beforeThemeResolution).toBe(0);
      expect(context.__afterThemeResolutionCall).toBe(0);
      expect(context.__resolvedThemeResult).toEqual({
        evaluations: 1,
        marker: 'TYPE_ONLY_THEME',
        spacing: '12px',
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Keeps equally supported child themes unloaded because syntax order cannot resolve ownership. */
  it('returns undefined for tied reachable theme candidates', async () => {
    const projectRoot = await createTemporaryProject('reachable-tied-theme-preview-');

    try {
      await installFakeStyledComponentsPackage(projectRoot);
      await writeProjectFiles(projectRoot, {
        'first-child.tsx': [
          "import styled from 'styled-components';",
          "import type { theme } from './first-theme';",
          'export const FirstChild = styled.div``;',
        ].join('\n'),
        'first-theme.ts': [
          'globalThis.__firstThemeEvaluations =',
          '  (globalThis.__firstThemeEvaluations ?? 0) + 1;',
          "export const theme = { marker: 'FIRST_THEME' };",
        ].join('\n'),
        'second-child.tsx': [
          "import styled from 'styled-components';",
          "import type { theme } from './second-theme';",
          'export const SecondChild = styled.div``;',
        ].join('\n'),
        'second-theme.ts': [
          'globalThis.__secondThemeEvaluations =',
          '  (globalThis.__secondThemeEvaluations ?? 0) + 1;',
          "export const theme = { marker: 'SECOND_THEME' };",
        ].join('\n'),
      });

      const context = await executeReachableThemeFixture(
        projectRoot,
        [
          "import './first-child';",
          "import './second-child';",
          "import { resolvePreviewTheme } from 'react-preview:theme';",
          'globalThis.__previewCompletion = resolvePreviewTheme({}).then((theme) => {',
          '  globalThis.__tiedThemeResult = {',
          '    firstEvaluations: globalThis.__firstThemeEvaluations ?? 0,',
          '    isUndefined: theme === undefined,',
          '    secondEvaluations: globalThis.__secondThemeEvaluations ?? 0,',
          '  };',
          '});',
        ].join('\n'),
      );

      expect(context.__tiedThemeResult).toEqual({
        firstEvaluations: 0,
        isUndefined: true,
        secondEvaluations: 0,
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Merges an alias and a relative request after esbuild proves they resolve to one theme file. */
  it('canonicalizes mixed theme specifiers before graph scoring', async () => {
    const projectRoot = await createTemporaryProject('reachable-aliased-theme-preview-');

    try {
      await installFakeStyledComponentsPackage(projectRoot);
      await writeProjectFiles(projectRoot, {
        'alias-child.tsx': [
          "import styled from 'styled-components';",
          "import type { theme } from '@theme';",
          'export const AliasChild = styled.div``;',
        ].join('\n'),
        'relative-child.tsx': [
          "import styled from 'styled-components';",
          "import type { theme } from './theme';",
          'export const RelativeChild = styled.div``;',
        ].join('\n'),
        'theme.ts': [
          'globalThis.__canonicalThemeEvaluations =',
          '  (globalThis.__canonicalThemeEvaluations ?? 0) + 1;',
          "export const theme = { marker: 'CANONICAL_THEME' };",
        ].join('\n'),
        'tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.', paths: { '@theme': ['./theme'] } },
        }),
      });

      const context = await executeReachableThemeFixture(
        projectRoot,
        [
          "import './alias-child';",
          "import './relative-child';",
          "import { resolvePreviewTheme } from 'react-preview:theme';",
          'globalThis.__previewCompletion = resolvePreviewTheme({}).then((theme) => {',
          '  globalThis.__canonicalThemeResult = {',
          '    evaluations: globalThis.__canonicalThemeEvaluations ?? 0,',
          '    marker: theme?.marker,',
          '  };',
          '});',
        ].join('\n'),
      );

      expect(context.__canonicalThemeResult).toEqual({
        evaluations: 1,
        marker: 'CANONICAL_THEME',
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Gives one runtime value reference precedence over several type-only child references. */
  it('selects a value theme above accumulated type-only evidence', async () => {
    const projectRoot = await createTemporaryProject('reachable-value-theme-preview-');

    try {
      await installFakeStyledComponentsPackage(projectRoot);
      await writeProjectFiles(projectRoot, {
        'type-child-one.tsx': createTypeOnlyChildSource('TypeChildOne'),
        'type-child-three.tsx': createTypeOnlyChildSource('TypeChildThree'),
        'type-child-two.tsx': createTypeOnlyChildSource('TypeChildTwo'),
        'type-theme.ts': [
          'globalThis.__losingTypeThemeEvaluations =',
          '  (globalThis.__losingTypeThemeEvaluations ?? 0) + 1;',
          "export const theme = { marker: 'LOSING_TYPE_THEME' };",
        ].join('\n'),
        'value-child.tsx': [
          "import styled from 'styled-components';",
          "import { theme } from './value-theme';",
          'export const ValueChild = styled.div`color: ${theme.color.brand};`;',
        ].join('\n'),
        'value-theme.ts': [
          "export const theme = { marker: 'WINNING_VALUE_THEME', color: { brand: '#123456' } };",
        ].join('\n'),
      });

      const context = await executeReachableThemeFixture(
        projectRoot,
        [
          "import './type-child-one';",
          "import './type-child-two';",
          "import './type-child-three';",
          "import './value-child';",
          "import { resolvePreviewTheme } from 'react-preview:theme';",
          'globalThis.__previewCompletion = resolvePreviewTheme({}).then((theme) => {',
          '  globalThis.__valueThemeResult = {',
          '    color: theme?.color.brand,',
          '    losingEvaluations: globalThis.__losingTypeThemeEvaluations ?? 0,',
          '    marker: theme?.marker,',
          '  };',
          '});',
        ].join('\n'),
      );

      expect(context.__valueThemeResult).toEqual({
        color: '#123456',
        losingEvaluations: 0,
        marker: 'WINNING_VALUE_THEME',
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});

/** Creates an isolated nearest-package boundary beneath the repository's installed React. */
async function createTemporaryProject(prefix: string): Promise<string> {
  const projectRoot = await mkdtemp(path.join(PROJECT_ROOT, `test/fixtures/${prefix}`));
  await writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8');
  return projectRoot;
}

/** Writes one flat fixture graph after ensuring every requested parent directory exists. */
async function writeProjectFiles(
  projectRoot: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  await Promise.all(
    Object.entries(files).map(async ([relativePath, source]) => {
      const filePath = path.join(projectRoot, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, source, 'utf8');
    }),
  );
}

/** Produces one independently counted type-only reference to the shared losing candidate. */
function createTypeOnlyChildSource(componentName: string): string {
  return [
    "import styled from 'styled-components';",
    "import type { theme } from './type-theme';",
    `export const ${componentName} = styled.div\`\`;`,
  ].join('\n');
}

/**
 * Bundles transformed workspace children and executes the private theme bridge in a VM global.
 * The completion promise is awaited outside the VM so deferred imports finish before assertions.
 */
async function executeReachableThemeFixture(projectRoot: string, source: string): Promise<Context> {
  const transformer = new PreviewSourceTransformer({ projectRoot, workspaceRoot: projectRoot });
  const result = await build({
    absWorkingDir: projectRoot,
    bundle: true,
    define: { 'process.env.NODE_ENV': '"test"' },
    format: 'iife',
    globalName: 'ReachableThemePreviewFixture',
    logLevel: 'silent',
    platform: 'browser',
    plugins: [
      createPreviewThemeBridgePlugin({ projectRoot }),
      createPreviewThemeCandidatePlugin(),
      createWorkspaceSourcePlugin({
        snapshots: [],
        transformer,
        workspaceRoot: projectRoot,
      }),
    ],
    stdin: {
      contents: source,
      loader: 'js',
      resolveDir: projectRoot,
      sourcefile: '<reachable-theme-fixture>',
    },
    target: 'es2022',
    write: false,
  });
  const javascript = result.outputFiles[0]?.text;
  if (javascript === undefined) {
    throw new Error('The reachable-theme fixture emitted no JavaScript.');
  }

  const sandbox: Record<string, unknown> = {
    clearTimeout,
    console,
    queueMicrotask,
    setTimeout,
  };
  sandbox.globalThis = sandbox;
  const context = createContext(sandbox);
  runInContext(javascript, context, { timeout: 10_000 });
  const completion = context.__previewCompletion as Promise<unknown> | undefined;
  if (completion === undefined || typeof completion.then !== 'function') {
    throw new Error('The reachable-theme fixture did not expose its completion promise.');
  }
  await completion;
  return context;
}

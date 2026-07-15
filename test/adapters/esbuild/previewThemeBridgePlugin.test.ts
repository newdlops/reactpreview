/**
 * Verifies optional project styled-components resolution and structural theme behavior.
 * Temporary package roots keep the tests independent from a real styled-components dependency
 * while VM execution proves coercion, exact setup themes, and explicit opt-out semantics.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createContext, runInContext, type Context } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewThemeBridgePlugin } from '../../../src/adapters/esbuild/previewThemeBridgePlugin';
import {
  FAKE_STYLED_COMPONENTS_MARKER,
  installFakeStyledComponentsPackage,
} from './support/fakeStyledComponentsPackage';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('createPreviewThemeBridgePlugin', () => {
  /** Leaves an ordinary React element untouched when styled-components is not installed. */
  it('provides an identity wrapper when the project has no styled-components package', async () => {
    const projectRoot = await createTemporaryProject('theme-absent-preview-');

    try {
      const context = await executeThemeBridgeFixture(
        projectRoot,
        [
          "import { createThemePreviewElement } from 'react-preview:theme';",
          "const child = { marker: 'PLAIN_REACT_ELEMENT' };",
          'globalThis.__themeBridgeResult =',
          '  createThemePreviewElement(child, { configuration: undefined }) === child;',
        ].join('\n'),
      );

      expect(context.__themeBridgeResult).toBe(true);
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Resolves the target-owned ThemeProvider rather than introducing an extension-owned copy. */
  it('uses the styled-components package owned by the target project', async () => {
    const projectRoot = await createTemporaryProject('theme-project-package-preview-');

    try {
      await installFakeStyledComponentsPackage(projectRoot);
      const context = await executeThemeBridgeFixture(
        projectRoot,
        [
          "import { createThemePreviewElement } from 'react-preview:theme';",
          "import { ThemeProvider, projectMarker } from 'styled-components';",
          "const element = createThemePreviewElement('target', { configuration: undefined });",
          'globalThis.__themeBridgeResult = {',
          '  marker: element.type.projectMarker,',
          '  sameProvider: element.type === ThemeProvider,',
          '  sameMarker: element.type.projectMarker === projectMarker,',
          '};',
        ].join('\n'),
      );

      expect(context.__themeBridgeResult).toEqual({
        marker: FAKE_STYLED_COMPONENTS_MARKER,
        sameMarker: true,
        sameProvider: true,
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Supplies callable and coercible nested tokens without inventing project design values. */
  it('creates a structural fallback for nested mixins and theme helper calls', async () => {
    const projectRoot = await createTemporaryProject('theme-structural-preview-');

    try {
      await installFakeStyledComponentsPackage(projectRoot);
      const context = await executeThemeBridgeFixture(
        projectRoot,
        [
          "import { createThemePreviewElement } from 'react-preview:theme';",
          "const element = createThemePreviewElement('target', { configuration: undefined });",
          'const theme = element.props.theme;',
          'globalThis.__themeBridgeResult = {',
          "  callableSpacing: theme.spacing(2) === '',",
          '  emptyIteration: [...theme.flex.items].length === 0,',
          '  jsonToken: JSON.stringify(theme.color.brand) === \'""\',',
          "  nestedMixin: String(theme.flex.colCenter) === '',",
          '  numericToken: Number(theme.breakpoints.mobile) === 0,',
          '  thenIsAbsent: theme.then === undefined,',
          '};',
        ].join('\n'),
      );

      expect(context.__themeBridgeResult).toEqual({
        callableSpacing: true,
        emptyIteration: true,
        jsonToken: true,
        nestedMixin: true,
        numericToken: true,
        thenIsAbsent: true,
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Passes an exact setup-owned theme to ThemeProvider instead of merging structural tokens. */
  it('uses the exact theme supplied through themePreview configuration', async () => {
    const projectRoot = await createTemporaryProject('theme-custom-preview-');

    try {
      await installFakeStyledComponentsPackage(projectRoot);
      const context = await executeThemeBridgeFixture(
        projectRoot,
        [
          "import { createThemePreviewElement } from 'react-preview:theme';",
          'const configuredTheme = {',
          "  flex: { colCenter: 'CUSTOM_COLUMN_CENTER' },",
          "  spacing: (factor) => factor * 8 + 'px',",
          '};',
          "const element = createThemePreviewElement('target', {",
          '  configuration: { theme: configuredTheme },',
          '});',
          'globalThis.__themeBridgeResult = {',
          '  exactReference: element.props.theme === configuredTheme,',
          '  mixin: element.props.theme.flex.colCenter,',
          '  spacing: element.props.theme.spacing(2),',
          '};',
        ].join('\n'),
      );

      expect(context.__themeBridgeResult).toEqual({
        exactReference: true,
        mixin: 'CUSTOM_COLUMN_CENTER',
        spacing: '16px',
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Honors explicit opt-out without creating a ThemeProvider element. */
  it('returns the original child when themePreview is false', async () => {
    const projectRoot = await createTemporaryProject('theme-disabled-preview-');

    try {
      await installFakeStyledComponentsPackage(projectRoot);
      const context = await executeThemeBridgeFixture(
        projectRoot,
        [
          "import { createThemePreviewElement } from 'react-preview:theme';",
          "const child = { marker: 'DISABLED_THEME_CHILD' };",
          'globalThis.__themeBridgeResult =',
          '  createThemePreviewElement(child, { configuration: false }) === child;',
        ].join('\n'),
      );

      expect(context.__themeBridgeResult).toBe(true);
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});

/** Creates an isolated nearest-package boundary beneath the repository's React installation. */
async function createTemporaryProject(prefix: string): Promise<string> {
  const projectRoot = await mkdtemp(path.join(PROJECT_ROOT, `test/fixtures/${prefix}`));
  await writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8');
  return projectRoot;
}

/**
 * Bundles and executes one private theme bridge fixture in a browser-like VM global.
 *
 * @param projectRoot Nearest package root used by the bridge's optional dependency lookup.
 * @param source JavaScript fixture that records serializable assertions on `globalThis`.
 * @returns Context containing values committed by the generated fixture.
 */
async function executeThemeBridgeFixture(projectRoot: string, source: string): Promise<Context> {
  const result = await build({
    absWorkingDir: projectRoot,
    bundle: true,
    define: { 'process.env.NODE_ENV': '"test"' },
    format: 'iife',
    globalName: 'ThemePreviewFixture',
    logLevel: 'silent',
    platform: 'browser',
    plugins: [createPreviewThemeBridgePlugin({ projectRoot })],
    stdin: {
      contents: source,
      loader: 'js',
      resolveDir: projectRoot,
      sourcefile: '<theme-bridge-fixture>',
    },
    target: 'es2022',
    write: false,
  });
  const javascript = result.outputFiles[0]?.text;
  if (javascript === undefined) {
    throw new Error('The theme bridge fixture emitted no JavaScript.');
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
  return context;
}

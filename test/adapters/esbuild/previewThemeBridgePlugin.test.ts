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
  installDualFormatFakeStyledComponentsPackage,
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

  /** Keeps ESM bridge imports and CommonJS project consumers on one Context-owning package entry. */
  it('canonicalizes dual package formats to one styled-components instance', async () => {
    const projectRoot = await createTemporaryProject('theme-dual-format-preview-');

    try {
      await installDualFormatFakeStyledComponentsPackage(projectRoot);
      const context = await executeThemeBridgeFixture(
        projectRoot,
        [
          "import { createThemePreviewElement } from 'react-preview:theme';",
          "const projectStyledComponents = require('styled-components');",
          "const element = createThemePreviewElement('target', { configuration: undefined });",
          'globalThis.__themeBridgeResult = {',
          '  bridgeMarker: element.type.projectMarker,',
          '  projectMarker: projectStyledComponents.projectMarker,',
          '  sameProvider: element.type === projectStyledComponents.ThemeProvider,',
          '};',
        ].join('\n'),
      );

      expect(context.__themeBridgeResult).toEqual({
        bridgeMarker: 'CJS_THEME_PROVIDER',
        projectMarker: 'CJS_THEME_PROVIDER',
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

  /** Keeps an explicit setup theme exact and gives it precedence over automatic discovery. */
  it('prefers the exact theme supplied through themePreview configuration', async () => {
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
          'const discoveredTheme = {',
          "  flex: { colCenter: 'DISCOVERED_COLUMN_CENTER' },",
          '};',
          "const element = createThemePreviewElement('target', {",
          '  configuration: { theme: configuredTheme },',
          '  discoveredTheme,',
          '});',
          'globalThis.__themeBridgeResult = {',
          '  exactReference: element.props.theme === configuredTheme,',
          '  missingRemainsUndefined: element.props.theme.missing === undefined,',
          '  mixin: element.props.theme.flex.colCenter,',
          '  spacing: element.props.theme.spacing(2),',
          '};',
        ].join('\n'),
      );

      expect(context.__themeBridgeResult).toEqual({
        exactReference: true,
        missingRemainsUndefined: true,
        mixin: 'CUSTOM_COLUMN_CENTER',
        spacing: '16px',
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Preserves discovered primitives and CSS arrays while filling only absent object paths. */
  it('overlays a discovered theme without replacing its exact design tokens', async () => {
    const projectRoot = await createTemporaryProject('theme-discovered-preview-');

    try {
      await installFakeStyledComponentsPackage(projectRoot);
      const context = await executeThemeBridgeFixture(
        projectRoot,
        [
          "import { createThemePreviewElement } from 'react-preview:theme';",
          "const cssArray = ['display:flex;', 'align-items:center;'];",
          "const helper = (factor) => factor * 4 + 'px';",
          'const discoveredTheme = {',
          "  color: { brand: '#123456' },",
          '  flex: { colCenter: cssArray },',
          '  helper,',
          '};',
          "const firstElement = createThemePreviewElement('first', { discoveredTheme });",
          "const secondElement = createThemePreviewElement('second', { discoveredTheme });",
          'const firstTheme = firstElement.props.theme;',
          'const missingToken = firstTheme.color.missing;',
          'globalThis.__themeBridgeResult = {',
          '  arrayReference: firstTheme.flex.colCenter === cssArray,',
          "  exactHelperResult: firstTheme.helper(3) === '12px',",
          "  exactPrimitive: firstTheme.color.brand === '#123456',",
          "  missingTokenIsCallable: missingToken() === '',",
          "  missingTokenIsEmpty: String(missingToken) === '',",
          '  missingTokenIsStable: missingToken === firstTheme.color.missing,',
          '  nestedProxyIsStable: firstTheme.color === firstTheme.color,',
          '  rootProxyIsStable: firstTheme === secondElement.props.theme,',
          '};',
        ].join('\n'),
      );

      expect(context.__themeBridgeResult).toEqual({
        arrayReference: true,
        exactHelperResult: true,
        exactPrimitive: true,
        missingTokenIsCallable: true,
        missingTokenIsEmpty: true,
        missingTokenIsStable: true,
        nestedProxyIsStable: true,
        rootProxyIsStable: true,
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Repairs only a callable token hidden by an incomplete nested provider. */
  it('falls back to the exact root helper for an incompatible nested theme token', async () => {
    const projectRoot = await createTemporaryProject('theme-nested-helper-preview-');

    try {
      await installFakeStyledComponentsPackage(projectRoot);
      const context = await executeThemeBridgeFixture(
        projectRoot,
        [
          "import { createThemePreviewElement, readPreviewRuntimeStatus, resolvePreviewThemeHelper } from 'react-preview:theme';",
          'const discoveredTheme = {',
          "  layout: { gap: (factor) => factor * 3 + 'px' },",
          "  spacing: (factor) => factor * 8 + 'px',",
          '};',
          "createThemePreviewElement('target', { discoveredTheme });",
          'const localTheme = { layout: {}, spacing: { unit: 0.5 } };',
          "const firstSpacing = resolvePreviewThemeHelper(localTheme, ['spacing']);",
          "const secondSpacing = resolvePreviewThemeHelper(localTheme, ['spacing']);",
          'globalThis.__themeBridgeResult = {',
          "  nestedRootHelper: resolvePreviewThemeHelper(localTheme, ['layout', 'gap'])(2),",
          '  rootHelper: firstSpacing(2),',
          '  stableResolver: firstSpacing === secondSpacing,',
          "  statusMentionsRepair: readPreviewRuntimeStatus().includes('repaired 2 incompatible'),",
          '};',
        ].join('\n'),
      );

      expect(context.__themeBridgeResult).toEqual({
        nestedRootHelper: '6px',
        rootHelper: '16px',
        stableResolver: true,
        statusMentionsRepair: true,
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Repairs scalar and CSS-fragment paths and emits one bounded health event per repaired path. */
  it('falls back through non-callable theme values with live repair diagnostics', async () => {
    const projectRoot = await createTemporaryProject('theme-nested-value-preview-');

    try {
      await installFakeStyledComponentsPackage(projectRoot);
      const context = await executeThemeBridgeFixture(
        projectRoot,
        [
          "import { createThemePreviewElement, readPreviewRuntimeStatus, resolvePreviewThemeValue } from 'react-preview:theme';",
          'const healthEvents = [];',
          "globalThis[Symbol.for('newdlops.react-file-preview.page-inspector')] = {",
          '  recordRuntimeHealth: (event) => healthEvents.push(event),',
          '};',
          "createThemePreviewElement('target', { discoveredTheme: { color: { black: '#222' } } });",
          "const evidence = { sourcePath: '/workspace/ErrorStatus.tsx', line: 54, column: 31 };",
          "const rootValue = resolvePreviewThemeValue({}, ['color', 'black'], evidence);",
          "const structuralValue = resolvePreviewThemeValue({}, ['flex', 'rowBetween'], evidence);",
          "const invalidColorValue = resolvePreviewThemeValue({ color: { primary: {} } }, ['color', 'primary'], evidence);",
          "const localValue = resolvePreviewThemeValue({ color: { black: '#111' } }, ['color', 'black'], evidence);",
          'globalThis.__themeBridgeResult = {',
          '  boundaryDetail: healthEvents[0]?.detail,',
          '  eventNames: healthEvents.map((event) => event.event),',
          '  localValue,',
          '  invalidColorValue,',
          '  rootValue,',
          '  status: readPreviewRuntimeStatus(),',
          '  structuralValue: String(structuralValue),',
          '};',
        ].join('\n'),
      );

      expect(context.__themeBridgeResult).toMatchObject({
        boundaryDetail: {
          expectedTradeoffs: ['canonical-commonjs-entry-may-reduce-tree-shaking'],
          resolutionKind: 'require-call',
          singletonStrategy: 'canonical-exact-bare-import',
          strategy: 'discovered',
        },
        eventNames: [
          'theme-boundary-composed',
          'theme-token-repaired',
          'theme-token-repaired',
          'theme-token-repaired',
        ],
        invalidColorValue: '#4b8bd0',
        localValue: '#111',
        rootValue: '#222',
        structuralValue: '',
      });
      expect((context.__themeBridgeResult as { status: string }).status).toContain(
        'repaired 3 missing non-callable theme token(s)',
      );
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Preserves a valid nested override instead of forcing the automatically discovered root token. */
  it('keeps a valid nested theme helper authoritative', async () => {
    const projectRoot = await createTemporaryProject('theme-valid-nested-helper-preview-');

    try {
      await installFakeStyledComponentsPackage(projectRoot);
      const context = await executeThemeBridgeFixture(
        projectRoot,
        [
          "import { createThemePreviewElement, readPreviewRuntimeStatus, resolvePreviewThemeHelper } from 'react-preview:theme';",
          "createThemePreviewElement('target', { discoveredTheme: { spacing: () => 'ROOT' } });",
          "const localTheme = { spacing: () => 'LOCAL' };",
          'globalThis.__themeBridgeResult = {',
          "  result: resolvePreviewThemeHelper(localTheme, ['spacing'])(2),",
          "  statusHasNoRepair: !readPreviewRuntimeStatus().includes('repaired'),",
          '};',
        ].join('\n'),
      );

      expect(context.__themeBridgeResult).toEqual({
        result: 'LOCAL',
        statusHasNoRepair: true,
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Recovers a throwing numeric helper only when its own finite unit proves a rem conversion. */
  it('uses a discovered helper unit to recover numeric and array spacing arguments', async () => {
    const projectRoot = await createTemporaryProject('theme-helper-unit-preview-');

    try {
      await installFakeStyledComponentsPackage(projectRoot);
      const context = await executeThemeBridgeFixture(
        projectRoot,
        [
          "import { createThemePreviewElement } from 'react-preview:theme';",
          "const spacing = () => { throw new Error('missing project global'); };",
          'spacing.unit = 0.8;',
          "const unsafeHelper = () => { throw new Error('no numeric contract'); };",
          'const discoveredTheme = { spacing, unsafeHelper };',
          "const element = createThemePreviewElement('target', { discoveredTheme });",
          'const theme = element.props.theme;',
          'globalThis.__themeBridgeResult = {',
          "  invalidArgumentIsEmpty: theme.spacing('2') === '',",
          "  nestedArguments: theme.spacing(1.5, [4, 7]) === '1.2rem 3.2rem 5.6rem',",
          "  noUnitIsEmpty: theme.unsafeHelper(2) === '',",
          '  stableHelperProxy: theme.spacing === theme.spacing,',
          '  unitIsExact: theme.spacing.unit === 0.8,',
          '};',
        ].join('\n'),
      );

      expect(context.__themeBridgeResult).toEqual({
        invalidArgumentIsEmpty: true,
        nestedArguments: true,
        noUnitIsEmpty: true,
        stableHelperProxy: true,
        unitIsExact: true,
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Applies exact browser defaults and reads a bounded rem declaration from static CSS arrays. */
  it('applies minimal document defaults from a discovered theme', async () => {
    const projectRoot = await createTemporaryProject('theme-document-defaults-preview-');

    try {
      await installFakeStyledComponentsPackage(projectRoot);
      const context = await executeThemeBridgeFixture(
        projectRoot,
        [
          "import { createThemePreviewElement } from 'react-preview:theme';",
          'globalThis.document = {',
          "  body: { style: { backgroundColor: '', color: '', fontFamily: '' } },",
          "  documentElement: { style: { fontSize: '' } },",
          '};',
          'const discoveredTheme = {',
          "  color: { pageBackground: '#f7f7f7', bodyText: '#222222' },",
          "  fontFamily: { default: 'Preview Sans, sans-serif' },",
          "  typography: { body: ['font-size: ', ['1.6', 'rem;'], ' line-height: 1.4;'] },",
          '};',
          "createThemePreviewElement('target', { discoveredTheme });",
          'globalThis.__themeBridgeResult = {',
          '  ...document.body.style,',
          '  rootFontSize: document.documentElement.style.fontSize,',
          '};',
        ].join('\n'),
      );

      expect(context.__themeBridgeResult).toEqual({
        backgroundColor: '#f7f7f7',
        color: '#222222',
        fontFamily: 'Preview Sans, sans-serif',
        rootFontSize: '10px',
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Gives an explicit root size priority and honors the complete document-style opt-out. */
  it('bounds discovered document mutation through themePreview configuration', async () => {
    const projectRoot = await createTemporaryProject('theme-document-options-preview-');

    try {
      await installFakeStyledComponentsPackage(projectRoot);
      const context = await executeThemeBridgeFixture(
        projectRoot,
        [
          "import { createThemePreviewElement } from 'react-preview:theme';",
          'const discoveredTheme = {',
          "  color: { pageBackground: '#f7f7f7', bodyText: '#222222' },",
          "  fontFamily: { default: 'Preview Sans' },",
          "  typography: { body: 'font-size: 1.6rem;' },",
          '};',
          'globalThis.document = {',
          "  body: { style: { backgroundColor: '', color: '', fontFamily: '' } },",
          "  documentElement: { style: { fontSize: '18px' } },",
          '};',
          "createThemePreviewElement('configured', {",
          "  configuration: { rootFontSize: '12px' },",
          '  discoveredTheme,',
          '});',
          'const configuredRootFontSize = document.documentElement.style.fontSize;',
          'globalThis.document = {',
          "  body: { style: { backgroundColor: '', color: '', fontFamily: '' } },",
          "  documentElement: { style: { fontSize: '18px' } },",
          '};',
          "createThemePreviewElement('existing-root', { discoveredTheme });",
          'const existingRootFontSize = document.documentElement.style.fontSize;',
          'globalThis.document = {',
          "  body: { style: { backgroundColor: 'KEEP', color: 'KEEP', fontFamily: 'KEEP' } },",
          "  documentElement: { style: { fontSize: 'KEEP' } },",
          '};',
          "createThemePreviewElement('disabled', {",
          "  configuration: { documentStyles: false, rootFontSize: '9px' },",
          '  discoveredTheme,',
          '});',
          'globalThis.__themeBridgeResult = {',
          '  configuredRootFontSize,',
          '  disabledBody: { ...document.body.style },',
          '  disabledRootFontSize: document.documentElement.style.fontSize,',
          '  existingRootFontSize,',
          '};',
        ].join('\n'),
      );

      expect(context.__themeBridgeResult).toEqual({
        configuredRootFontSize: '12px',
        disabledBody: {
          backgroundColor: 'KEEP',
          color: 'KEEP',
          fontFamily: 'KEEP',
        },
        disabledRootFontSize: 'KEEP',
        existingRootFontSize: '18px',
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

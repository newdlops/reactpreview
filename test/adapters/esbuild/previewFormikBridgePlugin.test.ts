/**
 * Verifies optional project Formik resolution and the generated static form context boundary.
 * Fixtures execute real esbuild output in a VM, proving package identity and runtime policy without
 * installing Formik as an extension dependency or rendering application code in a browser.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createContext, runInContext, type Context } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewFormikBridgePlugin } from '../../../src/adapters/esbuild/previewFormikBridgePlugin';
import { FAKE_FORMIK_MARKER, installFakeFormikPackage } from './support/fakeFormikPackage';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('createPreviewFormikBridgePlugin', () => {
  /** Leaves ordinary React projects unchanged while retaining registration-safe exports. */
  it('provides an identity wrapper when the project has no Formik package', async () => {
    const projectRoot = await createTemporaryProject('formik-absent-preview-');

    try {
      const context = await executeFormikBridgeFixture(
        projectRoot,
        [
          "import { createFormikPreviewElement, registerPreviewFormikRequirement, readPreviewRuntimeStatus } from 'react-preview:formik';",
          'registerPreviewFormikRequirement({ consumesFormik: true, ownsFormik: false });',
          "const child = { marker: 'PLAIN_REACT_ELEMENT' };",
          'globalThis.__formikBridgeResult = {',
          '  identity: createFormikPreviewElement(child, { configuration: undefined }) === child,',
          '  status: readPreviewRuntimeStatus(),',
          '};',
        ].join('\n'),
      );

      expect(context.__formikBridgeResult).toEqual({
        identity: true,
        status: 'unavailable: formik was not resolved from the target project',
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Uses the exact Provider and hook exported from the target project's Formik package. */
  it('composes a project-owned hook provider only for an unowned consumer', async () => {
    const projectRoot = await createTemporaryProject('formik-hook-provider-preview-');

    try {
      await installFakeFormikPackage(projectRoot);
      const context = await executeFormikBridgeFixture(
        projectRoot,
        [
          "import { createFormikPreviewElement, registerPreviewFormikRequirement, readPreviewRuntimeStatus } from 'react-preview:formik';",
          "import { FormikProvider, projectMarker } from 'formik';",
          'registerPreviewFormikRequirement({ consumesFormik: true, ownsFormik: false });',
          "const element = createFormikPreviewElement('target', { configuration: undefined });",
          'const providerElement = element.type(element.props);',
          'const submitResult = providerElement.props.value.onSubmit({}, {});',
          'globalThis.__formikBridgeResult = {',
          '  emptyValues: Object.keys(providerElement.props.value.values).length === 0,',
          '  frozenValues: Object.isFrozen(providerElement.props.value.values),',
          '  marker: providerElement.type.projectMarker,',
          '  noOpSubmit: submitResult === undefined,',
          '  sameMarker: providerElement.type.projectMarker === projectMarker,',
          '  sameProvider: providerElement.type === FormikProvider,',
          '  status: readPreviewRuntimeStatus(),',
          '};',
        ].join('\n'),
      );

      expect(context.__formikBridgeResult).toEqual({
        emptyValues: true,
        frozenValues: true,
        marker: FAKE_FORMIK_MARKER,
        noOpSubmit: true,
        sameMarker: true,
        sameProvider: true,
        status: 'active: static Formik provider with empty initial values',
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Avoids an unnecessary outer boundary when reached code already owns Formik context. */
  it('preserves an application-owned provider and honors explicit setup opt-out', async () => {
    const projectRoot = await createTemporaryProject('formik-owned-provider-preview-');

    try {
      await installFakeFormikPackage(projectRoot);
      const context = await executeFormikBridgeFixture(
        projectRoot,
        [
          "import { createFormikPreviewElement, registerPreviewFormikRequirement, readPreviewRuntimeStatus } from 'react-preview:formik';",
          "const child = { marker: 'APPLICATION_FORMIK_PROVIDER' };",
          'registerPreviewFormikRequirement({ consumesFormik: true, ownsFormik: true });',
          'const ownedResult = createFormikPreviewElement(child, { configuration: undefined });',
          'const ownedStatus = readPreviewRuntimeStatus();',
          'const disabledResult = createFormikPreviewElement(child, { configuration: false });',
          'globalThis.__formikBridgeResult = {',
          '  disabledIdentity: disabledResult === child,',
          '  disabledStatus: readPreviewRuntimeStatus(),',
          '  ownedIdentity: ownedResult === child,',
          '  ownedStatus,',
          '};',
        ].join('\n'),
      );

      expect(context.__formikBridgeResult).toEqual({
        disabledIdentity: true,
        disabledStatus: 'disabled by setup (formikPreview=false)',
        ownedIdentity: true,
        ownedStatus: 'inactive: target graph provides its own Formik boundary',
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Copies setup values into stable, plain, deeply frozen containers with setup priority. */
  it('uses bounded setup-owned initial values without retaining mutable input', async () => {
    const projectRoot = await createTemporaryProject('formik-setup-values-preview-');

    try {
      await installFakeFormikPackage(projectRoot);
      const context = await executeFormikBridgeFixture(
        projectRoot,
        [
          "import { createFormikPreviewElement, registerPreviewFormikRequirement, readPreviewRuntimeStatus } from 'react-preview:formik';",
          'registerPreviewFormikRequirement({ consumesFormik: true, ownsFormik: false });',
          "const configuredValues = { items: [{ count: 2 }], profile: { name: 'Preview' } };",
          'const configuration = { initialValues: configuredValues };',
          "const first = createFormikPreviewElement('first', { configuration });",
          "const second = createFormikPreviewElement('second', { configuration });",
          'const firstProvider = first.type(first.props);',
          'const secondProvider = second.type(second.props);',
          'const values = firstProvider.props.value.values;',
          'globalThis.__formikBridgeResult = {',
          '  copied: values !== configuredValues,',
          '  frozenArray: Object.isFrozen(values.items),',
          '  frozenNested: Object.isFrozen(values.profile),',
          '  frozenRoot: Object.isFrozen(values),',
          '  name: values.profile.name,',
          '  plainRoot: Object.getPrototypeOf(values) === Object.prototype,',
          '  stable: values === secondProvider.props.value.values,',
          '  status: readPreviewRuntimeStatus(),',
          '};',
        ].join('\n'),
      );

      expect(context.__formikBridgeResult).toEqual({
        copied: true,
        frozenArray: true,
        frozenNested: true,
        frozenRoot: true,
        name: 'Preview',
        plainRoot: true,
        stable: true,
        status: 'active: static Formik provider with setup-owned initial values',
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Rejects cyclic or executable setup data as one empty static form rather than partially copying. */
  it('rejects invalid configured values at the runtime boundary', async () => {
    const projectRoot = await createTemporaryProject('formik-invalid-values-preview-');

    try {
      await installFakeFormikPackage(projectRoot);
      const context = await executeFormikBridgeFixture(
        projectRoot,
        [
          "import { createFormikPreviewElement, registerPreviewFormikRequirement, readPreviewRuntimeStatus } from 'react-preview:formik';",
          'registerPreviewFormikRequirement({ consumesFormik: true, ownsFormik: false });',
          'const initialValues = { profile: {} };',
          'initialValues.profile.parent = initialValues;',
          "const element = createFormikPreviewElement('target', { configuration: { initialValues } });",
          'const providerElement = element.type(element.props);',
          'globalThis.__formikBridgeResult = {',
          '  empty: Object.keys(providerElement.props.value.values).length === 0,',
          '  prototypeClean: Object.prototype.parent === undefined,',
          '  status: readPreviewRuntimeStatus(),',
          '};',
        ].join('\n'),
      );

      expect(context.__formikBridgeResult).toEqual({
        empty: true,
        prototypeClean: true,
        status:
          'active: static Formik provider with empty values (invalid setup initialValues rejected)',
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Falls back to the public Formik render-prop component for compatible older package surfaces. */
  it('supports a project-owned Formik render-prop boundary', async () => {
    const projectRoot = await createTemporaryProject('formik-render-prop-preview-');

    try {
      await installFakeFormikPackage(projectRoot, 'render-prop');
      const context = await executeFormikBridgeFixture(
        projectRoot,
        [
          "import { createFormikPreviewElement, registerPreviewFormikRequirement, readPreviewRuntimeStatus } from 'react-preview:formik';",
          "import { Formik, projectMarker } from 'formik';",
          'registerPreviewFormikRequirement({ consumesFormik: true, ownsFormik: false });',
          "const element = createFormikPreviewElement('target', { configuration: undefined });",
          'const formikElement = element.type(element.props);',
          'const renderedChild = formikElement.type(formikElement.props);',
          'globalThis.__formikBridgeResult = {',
          "  child: renderedChild === 'target',",
          '  marker: formikElement.type.projectMarker,',
          '  sameComponent: formikElement.type === Formik,',
          '  sameMarker: formikElement.type.projectMarker === projectMarker,',
          '  status: readPreviewRuntimeStatus(),',
          '};',
        ].join('\n'),
      );

      expect(context.__formikBridgeResult).toEqual({
        child: true,
        marker: FAKE_FORMIK_MARKER,
        sameComponent: true,
        sameMarker: true,
        status: 'active: static Formik provider with empty initial values',
      });
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
 * Bundles and executes one private Formik bridge fixture in a browser-like VM global.
 *
 * @param projectRoot Nearest target package root used by optional Formik lookup.
 * @param source JavaScript fixture that records serializable assertions on `globalThis`.
 * @returns Context containing values committed by the generated fixture.
 */
async function executeFormikBridgeFixture(projectRoot: string, source: string): Promise<Context> {
  const result = await build({
    absWorkingDir: projectRoot,
    bundle: true,
    define: { 'process.env.NODE_ENV': '"test"' },
    format: 'iife',
    globalName: 'FormikPreviewFixture',
    logLevel: 'silent',
    platform: 'browser',
    plugins: [createPreviewFormikBridgePlugin({ projectRoot })],
    stdin: {
      contents: source,
      loader: 'js',
      resolveDir: projectRoot,
      sourcefile: '<formik-bridge-fixture>',
    },
    target: 'es2022',
    write: false,
  });
  const javascript = result.outputFiles[0]?.text;
  if (javascript === undefined) {
    throw new Error('The Formik bridge fixture emitted no JavaScript.');
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

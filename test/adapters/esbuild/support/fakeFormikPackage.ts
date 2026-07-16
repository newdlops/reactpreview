/**
 * Installs a tiny project-owned Formik package for optional bridge fixtures.
 * The implementation exposes observable provider identity and configuration without adding Formik
 * to the extension's own dependency graph or requiring a DOM renderer in focused runtime tests.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Marker attached to fake package exports so tests can prove exact package-instance resolution. */
export const FAKE_FORMIK_MARKER = 'PROJECT_OWNED_FORMIK_MARKER';

/** Public API shape installed for one fixture project. */
export type FakeFormikPackageKind = 'hooks' | 'render-prop';

/**
 * Writes a minimal ESM Formik package under the supplied isolated project root.
 *
 * @param projectRoot Temporary package root that should own the fake Formik dependency.
 * @param kind Hook/provider exports or the older compatible render-prop component surface.
 * @returns Promise resolved after package metadata and source have been written.
 */
export async function installFakeFormikPackage(
  projectRoot: string,
  kind: FakeFormikPackageKind = 'hooks',
): Promise<void> {
  const packageDirectory = path.join(projectRoot, 'node_modules', 'formik');
  await mkdir(packageDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(packageDirectory, 'package.json'),
      JSON.stringify({
        exports: './index.js',
        module: './index.js',
        name: 'formik',
        type: 'module',
      }),
      'utf8',
    ),
    writeFile(
      path.join(packageDirectory, 'index.js'),
      kind === 'hooks' ? createHookPackageSource() : createRenderPropPackageSource(),
      'utf8',
    ),
  ]);
}

/** Creates a dependency-free FormikProvider/useFormik compatibility module. */
function createHookPackageSource(): string {
  return [
    `export const projectMarker = ${JSON.stringify(FAKE_FORMIK_MARKER)};`,
    'export function useFormik(configuration) {',
    '  globalThis.__fakeFormikConfiguration = configuration;',
    '  return {',
    '    initialValues: configuration.initialValues,',
    '    onSubmit: configuration.onSubmit,',
    '    values: configuration.initialValues,',
    '  };',
    '}',
    'export function FormikProvider({ children, value }) {',
    '  globalThis.__fakeFormikContext = value;',
    '  return children;',
    '}',
    'FormikProvider.projectMarker = projectMarker;',
  ].join('\n');
}

/** Creates a dependency-free legacy-compatible Formik render-prop component module. */
function createRenderPropPackageSource(): string {
  return [
    `export const projectMarker = ${JSON.stringify(FAKE_FORMIK_MARKER)};`,
    'export function Formik(properties) {',
    '  globalThis.__fakeFormikConfiguration = properties;',
    '  const formikProps = {',
    '    initialValues: properties.initialValues,',
    '    onSubmit: properties.onSubmit,',
    '    values: properties.initialValues,',
    '  };',
    '  return typeof properties.children === "function"',
    '    ? properties.children(formikProps)',
    '    : properties.children;',
    '}',
    'Formik.projectMarker = projectMarker;',
  ].join('\n');
}

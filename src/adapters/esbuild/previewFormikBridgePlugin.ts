/**
 * Resolves the target project's Formik package as an optional private esbuild bridge.
 * Projects without Formik receive a no-op wrapper, while installed projects use their own exact
 * package instance so automatic and application context consumers share one context identity.
 */
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import { createPreviewFormikRuntimeSource } from './previewFormikRuntimeSource';
import {
  PREVIEW_FORMIK_BRIDGE_NAMESPACE,
  PREVIEW_FORMIK_SPECIFIER,
  PREVIEW_RESOLVE_GUARD,
} from './previewPluginProtocol';

const FORMIK_SPECIFIER = 'formik';
const FORMIK_BRIDGE_DATA_KIND = 'react-preview-formik-bridge-data';

/** Immutable project boundary used for Formik package resolution during one compilation. */
export interface PreviewFormikBridgePluginOptions {
  /** Nearest package root from which the target itself resolves Formik. */
  readonly projectRoot: string;
}

/** Serializable metadata carried from optional resolution into virtual-module loading. */
interface FormikBridgePluginData {
  /** Resolved package entry, omitted when the target project does not install Formik. */
  readonly formikModulePath?: string;
  /** Discriminant preventing unrelated plugin metadata from being read as bridge state. */
  readonly kind: typeof FORMIK_BRIDGE_DATA_KIND;
}

/**
 * Creates the optional Formik bridge consumed before a target export is rendered.
 * Package lookup failure is a supported state and produces identity behavior for non-Formik apps.
 *
 * @param options Nearest target package root used for browser-aware module resolution.
 * @returns Esbuild plugin scoped to one compilation request.
 */
export function createPreviewFormikBridgePlugin(options: PreviewFormikBridgePluginOptions): Plugin {
  return {
    name: 'react-preview-formik-bridge',
    setup(build): void {
      let resolutionPromise: Promise<string | undefined> | undefined;

      /** Resolves the private bridge and memoizes optional project Formik discovery. */
      async function resolveFormikBridge(
        arguments_: OnResolveArgs,
      ): Promise<OnResolveResult | undefined> {
        if (arguments_.path !== PREVIEW_FORMIK_SPECIFIER) {
          return undefined;
        }

        resolutionPromise ??= resolveOptionalFormik(build, options.projectRoot);
        const formikModulePath = await resolutionPromise;
        return {
          namespace: PREVIEW_FORMIK_BRIDGE_NAMESPACE,
          path: formikModulePath ?? path.join(options.projectRoot, 'empty-formik-preview.js'),
          pluginData: {
            kind: FORMIK_BRIDGE_DATA_KIND,
            ...(formikModulePath === undefined ? {} : { formikModulePath }),
          } satisfies FormikBridgePluginData,
        };
      }

      /** Loads a static Formik runtime or the capability's no-op compatibility surface. */
      function loadFormikBridge(arguments_: OnLoadArgs): OnLoadResult {
        const pluginData = readFormikBridgePluginData(arguments_.pluginData);
        if (pluginData?.formikModulePath === undefined) {
          return {
            contents: [
              '/** Leaves projects without Formik unchanged. */',
              'export function createFormikPreviewElement(children) { return children; }',
              '/** Accepts reached source evidence as a no-op when Formik is absent. */',
              'export function registerPreviewFormikRequirement(_requirement) {}',
              '/** Describes why the automatic Formik boundary is unavailable. */',
              "export function readPreviewRuntimeStatus() { return 'unavailable: formik was not resolved from the target project'; }",
            ].join('\n'),
            loader: 'js',
          };
        }

        return {
          contents: createPreviewFormikRuntimeSource({
            formikModulePath: pluginData.formikModulePath,
          }),
          loader: 'js',
          resolveDir: path.dirname(pluginData.formikModulePath),
          watchFiles: [pluginData.formikModulePath],
        };
      }

      build.onResolve({ filter: /^react-preview:formik$/ }, resolveFormikBridge);
      build.onLoad({ filter: /.*/, namespace: PREVIEW_FORMIK_BRIDGE_NAMESPACE }, loadFormikBridge);
    },
  };
}

/** Resolves a local browser-aware Formik entry without making absence a build error. */
async function resolveOptionalFormik(
  build: Parameters<Plugin['setup']>[0],
  projectRoot: string,
): Promise<string | undefined> {
  const resolution = await build.resolve(FORMIK_SPECIFIER, {
    kind: 'import-statement',
    pluginData: PREVIEW_RESOLVE_GUARD,
    resolveDir: projectRoot,
  });
  return resolution.errors.length === 0 && !resolution.external && resolution.namespace === 'file'
    ? resolution.path
    : undefined;
}

/** Narrows untrusted esbuild plugin metadata to this bridge's serializable contract. */
function readFormikBridgePluginData(pluginData: unknown): FormikBridgePluginData | undefined {
  if (typeof pluginData !== 'object' || pluginData === null || !('kind' in pluginData)) {
    return undefined;
  }
  return pluginData.kind === FORMIK_BRIDGE_DATA_KIND
    ? (pluginData as FormikBridgePluginData)
    : undefined;
}

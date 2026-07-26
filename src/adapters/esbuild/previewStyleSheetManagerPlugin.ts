/**
 * Exposes the statically selected StyleSheetManager configuration as a private browser module.
 * Binding imports are resolved from their original authored importer, so aliases and package
 * conditions stay identical to the project module that supplied the configuration.
 */
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import type {
  PreviewStyledComponentsPlan,
  PreviewStyleSheetManagerBindingReference,
} from './previewStyledComponentsPlan';
import {
  PREVIEW_RESOLVE_GUARD,
  PREVIEW_STYLE_SHEET_MANAGER_BINDING_SPECIFIER_PREFIX,
  PREVIEW_STYLE_SHEET_MANAGER_NAMESPACE,
  PREVIEW_STYLE_SHEET_MANAGER_SPECIFIER,
} from './previewPluginProtocol';

const MANAGER_DATA_KIND = 'react-preview-style-sheet-manager-data';
const BINDING_DATA_KIND = 'react-preview-style-sheet-manager-binding-data';

interface ManagerPluginData {
  readonly kind: typeof MANAGER_DATA_KIND;
}

interface BindingPluginData {
  readonly binding: PreviewStyleSheetManagerBindingReference;
  readonly kind: typeof BINDING_DATA_KIND;
  readonly resolvedModulePath: string;
}

/** Creates the virtual module that connects an immutable selection to executable imports. */
export function createPreviewStyleSheetManagerPlugin(plan: PreviewStyledComponentsPlan): Plugin {
  const bindings = collectBindings(plan);
  return {
    name: 'react-preview-style-sheet-manager',
    setup(build): void {
      /** Resolves the one virtual data module used by the generated entry. */
      function resolveManager(args: OnResolveArgs): OnResolveResult | undefined {
        if (args.path !== PREVIEW_STYLE_SHEET_MANAGER_SPECIFIER) {
          return undefined;
        }
        return {
          namespace: PREVIEW_STYLE_SHEET_MANAGER_NAMESPACE,
          path: PREVIEW_STYLE_SHEET_MANAGER_SPECIFIER,
          pluginData: { kind: MANAGER_DATA_KIND } satisfies ManagerPluginData,
        };
      }

      /** Resolves an authored binding from the importer that originally declared it. */
      async function resolveBinding(args: OnResolveArgs): Promise<OnResolveResult | undefined> {
        if (!args.path.startsWith(PREVIEW_STYLE_SHEET_MANAGER_BINDING_SPECIFIER_PREFIX)) {
          return undefined;
        }
        const indexText = args.path.slice(
          PREVIEW_STYLE_SHEET_MANAGER_BINDING_SPECIFIER_PREFIX.length,
        );
        if (!/^(?:0|[1-9]\d?)$/.test(indexText)) {
          return {
            errors: [{ text: 'React Preview received an invalid StyleSheetManager binding.' }],
          };
        }
        const binding = bindings[Number(indexText)];
        if (binding === undefined) {
          return { errors: [{ text: 'React Preview StyleSheetManager binding is unavailable.' }] };
        }
        const resolution = await build.resolve(binding.moduleSpecifier, {
          kind: binding.resolutionKind,
          pluginData: PREVIEW_RESOLVE_GUARD,
          resolveDir: path.dirname(binding.importerPath),
        });
        if (resolution.errors.length > 0) {
          return { errors: resolution.errors, warnings: resolution.warnings };
        }
        if (
          resolution.external ||
          resolution.namespace !== 'file' ||
          resolution.path.endsWith('.d.ts')
        ) {
          return {
            errors: [
              {
                text: `React Preview StyleSheetManager bindings must resolve to local files: ${binding.moduleSpecifier}`,
              },
            ],
            warnings: resolution.warnings,
          };
        }
        return {
          namespace: PREVIEW_STYLE_SHEET_MANAGER_NAMESPACE,
          path: resolution.path,
          pluginData: {
            binding,
            kind: BINDING_DATA_KIND,
            resolvedModulePath: resolution.path,
          } satisfies BindingPluginData,
          suffix: `?react-preview-style-sheet-manager-binding=${indexText}`,
          warnings: resolution.warnings,
        };
      }

      /** Serializes the bounded host plan and binding imports into the manager data module. */
      function loadManager(args: OnLoadArgs): OnLoadResult {
        if (!isManagerPluginData(args.pluginData)) {
          return { errors: [{ text: 'React Preview lost StyleSheetManager plan metadata.' }] };
        }
        const imports = bindings.map(
          (_binding, index) =>
            `import * as previewStyleSheetManagerBinding${index.toString()} from ${JSON.stringify(`${PREVIEW_STYLE_SHEET_MANAGER_BINDING_SPECIFIER_PREFIX}${index.toString()}`)};`,
        );
        const browserPlan = createBrowserPlan(plan, bindings);
        return {
          contents: [
            ...imports,
            `export const previewStyleSheetManagerPlan = Object.freeze(${browserPlan});`,
          ].join('\n'),
          loader: 'js',
        };
      }

      /** Adapts one resolved authored module to a default-only private binding module. */
      function loadBinding(args: OnLoadArgs): OnLoadResult {
        const data: unknown = args.pluginData;
        if (!isBindingPluginData(data)) {
          return { errors: [{ text: 'React Preview lost StyleSheetManager binding metadata.' }] };
        }
        const access = data.binding.access;
        const imported =
          access.kind === 'default'
            ? 'previewStyleSheetManagerModule.default'
            : `previewStyleSheetManagerModule[${JSON.stringify(access.exportName)}]`;
        return {
          contents: [
            `import * as previewStyleSheetManagerModule from ${JSON.stringify(data.resolvedModulePath.replaceAll('\\\\', '/'))};`,
            `export default ${imported};`,
          ].join('\n'),
          loader: 'js',
          resolveDir: path.dirname(data.binding.importerPath),
          watchFiles: [args.path],
        };
      }

      build.onResolve({ filter: /^react-preview:style-sheet-manager$/ }, resolveManager);
      build.onResolve({ filter: /^react-preview:style-sheet-manager-binding\// }, resolveBinding);
      build.onLoad(
        {
          filter: /^react-preview:style-sheet-manager$/,
          namespace: PREVIEW_STYLE_SHEET_MANAGER_NAMESPACE,
        },
        loadManager,
      );
      build.onLoad({ filter: /.*/, namespace: PREVIEW_STYLE_SHEET_MANAGER_NAMESPACE }, loadBinding);
    },
  };
}

/** De-duplicates selected imported values while retaining their stable layer order. */
function collectBindings(
  plan: PreviewStyledComponentsPlan,
): readonly PreviewStyleSheetManagerBindingReference[] {
  const values: PreviewStyleSheetManagerBindingReference[] = [];
  for (const layer of plan.layers) {
    if (layer.shouldForwardProp !== undefined) values.push(layer.shouldForwardProp);
    const plugins = layer.stylisPlugins;
    if (plugins?.kind === 'binding') values.push(plugins.value);
    if (plugins?.kind === 'binding-array') values.push(...plugins.values);
  }
  const unique = new Map<string, PreviewStyleSheetManagerBindingReference>();
  for (const value of values) unique.set(JSON.stringify(value), value);
  return [...unique.values()].slice(0, 16);
}

/** Emits a path-free browser-safe representation of the selected plan. */
function createBrowserPlan(
  plan: PreviewStyledComponentsPlan,
  bindings: readonly PreviewStyleSheetManagerBindingReference[],
): string {
  const bindingValue = (binding: PreviewStyleSheetManagerBindingReference): string => {
    const index = bindings.findIndex(
      (candidate) => JSON.stringify(candidate) === JSON.stringify(binding),
    );
    return index < 0 ? 'undefined' : `previewStyleSheetManagerBinding${index.toString()}.default`;
  };
  const layers = plan.layers.map((layer) => {
    const fields: string[] = [`sourceKind:${JSON.stringify(layer.sourceKind)}`];
    if (layer.disableCSSOMInjection !== undefined)
      fields.push(`disableCSSOMInjection:${String(layer.disableCSSOMInjection)}`);
    if (layer.disableVendorPrefixes !== undefined)
      fields.push(`disableVendorPrefixes:${String(layer.disableVendorPrefixes)}`);
    if (layer.enableVendorPrefixes !== undefined)
      fields.push(`enableVendorPrefixes:${String(layer.enableVendorPrefixes)}`);
    if (layer.shouldForwardProp !== undefined)
      fields.push(`shouldForwardProp:${bindingValue(layer.shouldForwardProp)}`);
    if (layer.stylisPlugins?.kind === 'binding')
      fields.push(`stylisPlugins:[${bindingValue(layer.stylisPlugins.value)}]`);
    if (layer.stylisPlugins?.kind === 'binding-array')
      fields.push(`stylisPlugins:[${layer.stylisPlugins.values.map(bindingValue).join(',')}]`);
    return `Object.freeze({${fields.join(',')}})`;
  });
  return `{
evidence:${JSON.stringify(plan.evidence)},
ignoredReasons:Object.freeze(${JSON.stringify(plan.ignoredReasons)}),
layers:Object.freeze([${layers.join(',')}]),
sharedRuntimeChunk:${String(plan.sharedRuntimeChunk)},
version:${String(plan.version)}
}`;
}

/** Narrows virtual-module metadata before loading the root data module. */
function isManagerPluginData(value: unknown): value is ManagerPluginData {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === MANAGER_DATA_KIND
  );
}

/** Narrows virtual-module metadata before loading a resolved binding module. */
function isBindingPluginData(value: unknown): value is BindingPluginData {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === BINDING_DATA_KIND
  );
}

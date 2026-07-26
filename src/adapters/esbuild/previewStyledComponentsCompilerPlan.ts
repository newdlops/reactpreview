/**
 * Keeps the styled-components build shape immutable for one compiler revision.
 *
 * This deliberately contains no generated entry source or runtime instance key: either would
 * invalidate an incremental esbuild context even when the package/runtime split is unchanged.
 */
import type { Plugin } from 'esbuild';
import type { PreviewRenderMode } from '../../domain/preview';
import {
  createPreviewBuildEntryStrategy,
  PREVIEW_BUILD_ENTRY_STRATEGY_VERSION,
  type PreviewBuildEntryStrategy,
} from './previewBuildEntryStrategy';
import type { PreviewReactDomRootKind } from './previewReactDomRootRuntimeSource';
import { createPreviewStyleSheetManagerPlugin } from './previewStyleSheetManagerPlugin';
import type { PreviewStyledComponentsPlan } from './previewStyledComponentsPlan';

/** Arguments accepted by the one-shot entry strategy factory. */
export interface CreatePreviewStyledComponentsEntryStrategyOptions {
  readonly entrySource: string;
  readonly reactDomRootKind: PreviewReactDomRootKind;
  readonly renderMode: PreviewRenderMode;
  readonly resolveDir: string;
  readonly singleEntryPoint: string;
}

/** Stable compiler inputs derived solely from the bounded host-side styled-components plan. */
export interface PreviewStyledComponentsCompilerPlan {
  /** Include this value in the incremental context identity, but never source text/runtime keys. */
  readonly buildIdentity: Readonly<{
    readonly entryStrategy: Readonly<{
      readonly kind: 'single-entry' | 'shared-styled-runtime';
      readonly version: typeof PREVIEW_BUILD_ENTRY_STRATEGY_VERSION;
    }>;
    readonly styledComponentsPlan: PreviewStyledComponentsPlan;
  }>;
  readonly createEntryStrategy: (
    options: CreatePreviewStyledComponentsEntryStrategyOptions,
  ) => PreviewBuildEntryStrategy;
  readonly dependencyPaths: readonly string[];
  readonly managerPlanPlugin: Plugin;
  readonly styledComponentsPlan: PreviewStyledComponentsPlan;
}

/** Creates the single styled-components orchestration plan used throughout one `runBuild` call. */
export function createPreviewStyledComponentsCompilerPlan(
  styledComponentsPlan: PreviewStyledComponentsPlan,
): PreviewStyledComponentsCompilerPlan {
  const kind = styledComponentsPlan.sharedRuntimeChunk ? 'shared-styled-runtime' : 'single-entry';
  return Object.freeze({
    buildIdentity: Object.freeze({
      entryStrategy: Object.freeze({ kind, version: PREVIEW_BUILD_ENTRY_STRATEGY_VERSION }),
      styledComponentsPlan,
    }),
    createEntryStrategy: (options: CreatePreviewStyledComponentsEntryStrategyOptions) =>
      createPreviewBuildEntryStrategy({
        ...options,
        sharedRuntimeChunk: styledComponentsPlan.sharedRuntimeChunk,
      }),
    dependencyPaths: Object.freeze([...new Set(styledComponentsPlan.dependencyPaths)]),
    managerPlanPlugin: createPreviewStyleSheetManagerPlugin(styledComponentsPlan),
    styledComponentsPlan,
  });
}

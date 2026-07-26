/**
 * Owns the esbuild entry-point shape selected for a preview revision.
 * A shared strategy gives React and styled-components a package-only anchor, allowing esbuild to
 * place them in a reusable chunk while generated preview state stays on the main entry path.
 */
import path from 'node:path';
import type { Plugin } from 'esbuild';
import type { PreviewRenderMode } from '../../domain/preview';
import type { PreviewReactDomRootKind } from './previewReactDomRootRuntimeSource';
import {
  createPreviewBuildEntryPlugin,
  PREVIEW_MAIN_ENTRY_NAMESPACE,
  PREVIEW_MAIN_ENTRY_SPECIFIER,
  PREVIEW_RUNTIME_ANCHOR_NAMESPACE,
  PREVIEW_RUNTIME_ANCHOR_SPECIFIER,
} from './previewBuildEntryPlugin';
import type { PreviewBuildOutputSelection } from './previewBuildOutputPlanner';

/** Versioned identity included in the compiler build plan, never derived from source bytes. */
export const PREVIEW_BUILD_ENTRY_STRATEGY_VERSION = 1;

/** Input needed to generate one immutable entry strategy. */
export interface PreviewBuildEntryStrategyOptions {
  readonly entrySource: string;
  readonly reactDomRootKind: PreviewReactDomRootKind;
  readonly renderMode: PreviewRenderMode;
  readonly resolveDir: string;
  readonly singleEntryPoint?: string;
  readonly sharedRuntimeChunk: boolean;
}

/** Compiler-facing entry, output, and plugin configuration for exactly one esbuild invocation. */
export interface PreviewBuildEntryStrategy {
  readonly kind: 'single-entry' | 'shared-styled-runtime';
  readonly version: number;
  readonly outputSelection: PreviewBuildOutputSelection;
  readonly plugins: readonly Plugin[];
  readonly buildOptions:
    | {
        readonly entryPoints: Readonly<Record<string, string>>;
        readonly stdin?: never;
        readonly splitting: true;
      }
    | {
        readonly entryPoints?: never;
        readonly stdin: {
          readonly contents: string;
          readonly loader: 'tsx';
          readonly resolveDir: string;
          readonly sourcefile: string;
        };
        readonly splitting: false;
      };
}

/** Selects either the existing single stdin build or the package-runtime shared two-entry build. */
export function createPreviewBuildEntryStrategy(
  options: PreviewBuildEntryStrategyOptions,
): PreviewBuildEntryStrategy {
  if (!options.sharedRuntimeChunk) {
    return {
      buildOptions: {
        splitting: false,
        stdin: {
          contents: options.entrySource,
          loader: 'tsx',
          resolveDir: options.resolveDir,
          sourcefile: path.join(options.resolveDir, '<react-preview-entry>'),
        },
      },
      kind: 'single-entry',
      outputSelection: {
        mainEntryPoint: options.singleEntryPoint ?? '<react-preview-entry>',
        ignoredEntryPoints: [],
      },
      plugins: [],
      version: PREVIEW_BUILD_ENTRY_STRATEGY_VERSION,
    };
  }
  return {
    buildOptions: {
      entryPoints: {
        entry: PREVIEW_MAIN_ENTRY_SPECIFIER,
        'styled-runtime-anchor': PREVIEW_RUNTIME_ANCHOR_SPECIFIER,
      },
      splitting: true,
    },
    kind: 'shared-styled-runtime',
    outputSelection: {
      ignoredEntryPoints: [
        PREVIEW_RUNTIME_ANCHOR_NAMESPACE + ':' + PREVIEW_RUNTIME_ANCHOR_SPECIFIER,
      ],
      mainEntryPoint: PREVIEW_MAIN_ENTRY_NAMESPACE + ':' + PREVIEW_MAIN_ENTRY_SPECIFIER,
    },
    plugins: [
      createPreviewBuildEntryPlugin({
        entrySource: options.entrySource,
        resolveDir: options.resolveDir,
        runtimeAnchorSource: createRuntimeAnchorSource(
          options.reactDomRootKind,
          options.renderMode,
        ),
      }),
    ],
    version: PREVIEW_BUILD_ENTRY_STRATEGY_VERSION,
  };
}

/** Imports only runtime packages, so no preview state, providers, setup, or project modules leak in. */
function createRuntimeAnchorSource(
  reactDomRootKind: PreviewReactDomRootKind,
  renderMode: PreviewRenderMode,
): string {
  const reactDomImport =
    reactDomRootKind === 'client'
      ? "import * as ReactDomClient from 'react-dom/client';"
      : "import * as ReactDom from 'react-dom';";
  const pageInspectorImport =
    renderMode === 'page-inspector' && reactDomRootKind === 'client'
      ? "\nimport * as ReactDom from 'react-dom';"
      : '';
  const reactDomBinding = reactDomRootKind === 'client' ? 'ReactDomClient' : 'ReactDom';
  const pageArray =
    renderMode === 'page-inspector' && reactDomRootKind === 'client' ? ', ReactDom' : '';
  return [
    "import * as React from 'react';",
    reactDomImport,
    pageInspectorImport,
    "import * as StyledComponents from 'styled-components';",
    `export const previewRuntimeAnchor = Object.freeze([React, ${reactDomBinding}${pageArray}, StyledComponents]);`,
  ].join('\n');
}

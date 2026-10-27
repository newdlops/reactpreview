/**
 * Declares the immutable policy used while application source is prepared for a preview build.
 * Keeping this contract outside the implementation prevents the already broad resource transformer
 * from becoming a second configuration boundary as new render-only compatibility layers are added.
 */
import type { PreviewPrismaColumnDefaults } from '../previewPrismaColumnDefaults';
import type { PreviewStaticModuleResolver } from '../previewStaticModuleResolver';
import type { PreviewTypeOracleView } from '../typeOracle/previewTypeOracle';
import type { PreviewLocalTargetExportInstrumentation } from './previewLocalTargetExportInstrumentation';

/** Immutable transformer configuration for one compilation request. */
export interface PreviewSourceTransformerOptions {
  /** Installed AG Grid all-module package restored only when reached source imports ag-grid-react. */
  readonly agGridModulePackage?: 'community' | 'enterprise';
  /** Compiler-proven Page Execution surfaces that must retain the complete transform pipeline. */
  readonly criticalSurfaceSourcePaths?: readonly string[];
  /** Removes proven false-state overlays from fast builds behind visible provisional markers. */
  readonly deferDormantOverlayImports?: boolean;
  /** Lets selected-corridor dependencies with no preview-sensitive syntax use esbuild directly. */
  readonly selectiveDependencyPassThrough?: boolean;
  /** Active editor target whose direct component exports may receive bounded prop defaults. */
  readonly documentPath?: string;
  /** Exact target-path support modules that fast overlay deferral must keep executable. */
  readonly preservedDormantOverlaySourcePaths?: readonly string[];
  /** Exact dependency/global names worth checking in modules esbuild actually reaches. */
  readonly implicitPackageGlobalCandidateNames?: readonly string[];
  /** Project-aware resolver proving a free name maps to its exact installed package. */
  readonly implicitPackageGlobalResolver?: Pick<
    PreviewStaticModuleResolver,
    'isSideEffectFree' | 'resolve'
  >;
  /** Nearest inert tsconfig/jsconfig evidence used to preserve Preact or a custom JSX factory. */
  readonly jsxRuntimeResolver?: Pick<PreviewStaticModuleResolver, 'usesAlternativeJsxRuntime'>;
  /** Whether reached JSX conditions should expose authored/forced branch controls to Page Inspector. */
  readonly instrumentRenderConditions?: boolean;
  /** Whether proven browser backend calls should use editable no-network preview payloads. */
  readonly instrumentDataRequests?: boolean;
  /** Whether imported GraphQL fragments may survive circular module initialization with static source. */
  readonly instrumentGraphqlDocuments?: boolean;
  /** Whether render-critical custom hooks may receive visible, user-toggleable static fallbacks. */
  readonly instrumentRuntimeHookFallbacks?: boolean;
  /** Build-scoped declared-type oracle; hook fallbacks gain type-correct values when present. */
  readonly typeOracle?: PreviewTypeOracleView;
  /**
   * Canonical paths of modules served as render-only server contracts in this build. Query calls
   * rooted at their imports settle to the call site's declared result (needs `typeOracle` and
   * `graphqlModuleResolver`).
   */
  readonly serverContractSourcePaths?: readonly string[];
  /** String column defaults of the project's Prisma schema for typed server queries. */
  readonly prismaColumnDefaults?: PreviewPrismaColumnDefaults;
  /** Whether failing React effects may be logged and isolated from otherwise valid page output. */
  readonly instrumentRuntimeEffectIsolation?: boolean;
  /** Exact selected target bindings whose same-module references need the Inspector boundary. */
  readonly localTargetExportInstrumentation?: PreviewLocalTargetExportInstrumentation;
  /** Offsets where owner modules render the selected target, keyed by normalized owner path. */
  readonly selectedTargetOccurrences?: ReadonlyMap<string, readonly number[]>;
  /** Enables exact JSX tracking only when every selected path hop has a supported JSX identity. */
  readonly trackSelectedJsxOccurrences?: boolean;
  /** Bounded source proof that this exact imported hook owns only Router-query/local UI state. */
  readonly admitSelectedPageTabHook?: (
    specifier: string,
    importer: string,
    exportName: string,
  ) => Promise<boolean>;
  /** Resolver used only to trace an interpolated GraphQL fragment to authored workspace source. */
  readonly graphqlModuleResolver?: Pick<PreviewStaticModuleResolver, 'resolve'>;
  /** Dirty-editor source lookup consulted before the GraphQL catalog reads an on-disk module. */
  readonly readGraphqlSource?: (sourcePath: string) => string | undefined;
  /** Nearest package root used for the conventional public asset directory. */
  readonly projectRoot: string;
  /** Whether the nearest manifest or exact resolver proves a Next runtime for this project. */
  readonly projectUsesNextRuntime?: boolean;
  /** Whether inert package metadata declares an installed or managed React runtime. */
  readonly projectUsesReactRuntime?: boolean;
  /** Trusted workspace boundary used for every static filesystem expansion. */
  readonly workspaceRoot: string;
}

/**
 * Declares the immutable policy used while application source is prepared for a preview build.
 * Keeping this contract outside the implementation prevents the already broad resource transformer
 * from becoming a second configuration boundary as new render-only compatibility layers are added.
 */
import type { PreviewStaticModuleResolver } from '../previewStaticModuleResolver';

/** Immutable transformer configuration for one compilation request. */
export interface PreviewSourceTransformerOptions {
  /** Active editor target whose direct component exports may receive bounded prop defaults. */
  readonly documentPath?: string;
  /** Exact dependency/global names worth checking in modules esbuild actually reaches. */
  readonly implicitPackageGlobalCandidateNames?: readonly string[];
  /** Project-aware resolver proving a free name maps to its exact installed package. */
  readonly implicitPackageGlobalResolver?: Pick<PreviewStaticModuleResolver, 'resolve'>;
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
  /** Whether failing React effects may be logged and isolated from otherwise valid page output. */
  readonly instrumentRuntimeEffectIsolation?: boolean;
  /** Resolver used only to trace an interpolated GraphQL fragment to authored workspace source. */
  readonly graphqlModuleResolver?: Pick<PreviewStaticModuleResolver, 'resolve'>;
  /** Dirty-editor source lookup consulted before the GraphQL catalog reads an on-disk module. */
  readonly readGraphqlSource?: (sourcePath: string) => string | undefined;
  /** Nearest package root used for the conventional public asset directory. */
  readonly projectRoot: string;
  /** Whether inert package metadata declares an installed or managed React runtime. */
  readonly projectUsesReactRuntime?: boolean;
  /** Trusted workspace boundary used for every static filesystem expansion. */
  readonly workspaceRoot: string;
}

/**
 * Defines generic runtime dependency diagnostics embedded into every browser preview entry.
 * Rules inspect only a library-branded error message and never a stack path, keeping classification
 * stable across bundlers while avoiding assumptions about a particular repository's source tree.
 */

/** Actionable browser error classification shown before the original runtime details. */
export interface PreviewRuntimeDiagnostic {
  /** Stable category suitable for tests and future structured webview messages. */
  readonly kind: string;
  /** Recovery guidance that preserves project ownership of semantic state. */
  readonly recovery: string;
  /** Explanation that distinguishes a successful bundle from a failed application render. */
  readonly summary: string;
  /** Short user-facing heading rendered at the top of the runtime error text. */
  readonly title: string;
}

/** Library-branded message fragments associated with one diagnostic. */
export interface PreviewRuntimeDiagnosticRule extends PreviewRuntimeDiagnostic {
  /** Lowercase message fragments; any one exact fragment selects this rule. */
  readonly messageIncludes: readonly string[];
}

/**
 * Known context failures whose messages are owned by public ecosystem libraries.
 * Application names, paths, selectors, routes, and state fields deliberately never appear here.
 */
export const PREVIEW_RUNTIME_DIAGNOSTIC_RULES: readonly PreviewRuntimeDiagnosticRule[] = [
  {
    kind: 'redux-context',
    messageIncludes: ['could not find react-redux context value'],
    recovery:
      'Preview a small harness component or provide a network-free static store through .react-preview/setup.tsx.',
    summary:
      'The component bundle loaded, but this tree expects application state from React Redux.',
    title: 'React Redux provider required',
  },
  {
    kind: 'apollo-context',
    messageIncludes: ['could not find "client" in the context'],
    recovery:
      'Refresh an older pinned tab first. If the current setup disables the automatic static Apollo boundary, enable it or provide a memory-only client.',
    summary: 'The component bundle loaded, but an Apollo Client context was not available.',
    title: 'Apollo Client provider required',
  },
  {
    kind: 'apollo-invariant',
    messageIncludes: ['go.apollo.dev/c/err#'],
    recovery:
      'Inspect the locally decoded invariant payload and the Apollo boundary status below; the compact URL alone does not prove that a backend connection is required.',
    summary:
      'Apollo Client threw a compact invariant while evaluating or rendering the static preview.',
    title: 'Apollo Client runtime error',
  },
  {
    kind: 'router-context',
    messageIncludes: [
      'may be used only in the context of a <router>',
      'can only be used in the context of a <router>',
      'must be used within a routerprovider',
      'must be used within a data router',
    ],
    recovery:
      'Preview a route-aware harness or provide a MemoryRouter with explicit static entries through .react-preview/setup.tsx.',
    summary: 'The component bundle loaded, but this tree expects an application router context.',
    title: 'Router context required',
  },
  {
    kind: 'formik-context',
    messageIncludes: ['formik context is undefined'],
    recovery:
      'Inspect the Formik boundary status below. Refresh the pinned preview, provide bounded formikPreview.initialValues, or use a static form harness when the automatic boundary is disabled.',
    summary: 'The component bundle loaded, but this tree has no compatible Formik context.',
    title: 'Formik provider required',
  },
  {
    kind: 'theme-contract',
    messageIncludes: [
      'props.theme.',
      'theme.spacing is not a function',
      'themeprovider: please make sure',
    ],
    recovery:
      'Inspect the Theme boundary status below. The component needs the exact project theme shape when a structural fallback cannot preserve helper semantics.',
    summary:
      'The rendered tree received no compatible theme value or received a theme with a different runtime shape.',
    title: 'Theme contract mismatch',
  },
  {
    kind: 'custom-context',
    messageIncludes: [
      'must be used inside a provider',
      'must be used within a provider',
      'must be used within the provider',
    ],
    recovery:
      'Add a small static provider in .react-preview/setup.tsx; application-owned context values cannot be inferred safely from hook names alone.',
    summary:
      'An application or library hook explicitly reported that its React context provider is absent.',
    title: 'React context provider required',
  },
];

/** Generic explanation for unknown hooks, themes, props, and application-owned contexts. */
export const PREVIEW_RUNTIME_DIAGNOSTIC_FALLBACK: PreviewRuntimeDiagnostic = {
  kind: 'project-runtime',
  recovery:
    'Use a self-contained preview harness or .react-preview/setup.tsx for required providers, static state, routes, themes, and props.',
  summary:
    'The component bundle loaded successfully, but rendering failed inside its application runtime.',
  title: 'Project runtime setup required',
};

/**
 * Classifies one message through library-owned phrases only.
 * Stack text is intentionally not accepted so a package name in a generated path cannot produce a
 * false classification.
 *
 * @param message Error message read directly from a thrown value.
 * @returns Matching library diagnostic or the generic project-runtime fallback.
 */
export function classifyPreviewRuntimeMessage(message: string): PreviewRuntimeDiagnostic {
  const normalizedMessage = message.toLowerCase();
  return (
    PREVIEW_RUNTIME_DIAGNOSTIC_RULES.find((rule) =>
      rule.messageIncludes.some((fragment) => normalizedMessage.includes(fragment)),
    ) ?? PREVIEW_RUNTIME_DIAGNOSTIC_FALLBACK
  );
}

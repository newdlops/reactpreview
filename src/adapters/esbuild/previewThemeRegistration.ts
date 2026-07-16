/**
 * Converts static style evidence from one reachable source module into an inert theme registry.
 * The generated code never evaluates a candidate during module initialization: it records a
 * bounded loader so the browser entry can select and import one exact project theme on demand.
 */
import { collectPreviewStyleSignals, type PreviewStyleSignal } from './previewStyleInventory';
import { createPreviewThemeCandidateSpecifier } from './previewThemeCandidatePlugin';

/** Private virtual module shared by transformed sources and the generated preview entry. */
const PREVIEW_THEME_SPECIFIER = 'react-preview:theme';

/** Callback supplied by the source transformer to avoid generated identifier collisions. */
export type PreviewThemeBindingAllocator = (kind: string) => string;

/**
 * Creates module-scope registration statements for exact styled-components theme references.
 * Duplicate syntax in one importer is removed before code generation. Candidate modules stay
 * behind native `import()` boundaries, allowing esbuild to emit browser-loaded local chunks.
 *
 * @param sourcePath Absolute reached module path used as graph evidence identity.
 * @param sourceText Current editor or filesystem source inspected without execution.
 * @param allocateBinding Collision-safe identifier allocator owned by the source transformer.
 * @returns Hoist-safe import followed by bounded registration calls, or an empty list.
 */
export function createPreviewThemeRegistrationStatements(
  sourcePath: string,
  sourceText: string,
  allocateBinding: PreviewThemeBindingAllocator,
): readonly string[] {
  const signals = deduplicateSignals(collectPreviewStyleSignals(sourcePath, sourceText));
  if (signals.length === 0) {
    return [];
  }

  const registrationBinding = allocateBinding('themeRegistry');
  const statements = [
    `import { registerPreviewThemeCandidate as ${registrationBinding} } from ${JSON.stringify(PREVIEW_THEME_SPECIFIER)};`,
  ];
  for (const signal of signals) {
    const candidateKeyBinding = allocateBinding('themeCandidateKey');
    const loaderBinding = allocateBinding('themeCandidateLoader');
    const candidateSpecifier = createPreviewThemeCandidateSpecifier(signal);
    statements.push(
      `import { previewThemeCandidateKey as ${candidateKeyBinding}, loadPreviewTheme as ${loaderBinding} } from ${JSON.stringify(candidateSpecifier)};`,
      createRegistrationCall(registrationBinding, candidateKeyBinding, loaderBinding, signal),
    );
  }
  return statements;
}

/** Builds one JSON-safe registry call whose only executable field is a deferred ESM loader. */
function createRegistrationCall(
  binding: string,
  candidateKeyBinding: string,
  loaderBinding: string,
  signal: PreviewStyleSignal,
): string {
  const metadata = [
    `candidateKey: ${candidateKeyBinding}`,
    `confidence: ${JSON.stringify(signal.confidence)}`,
    `importerKey: ${JSON.stringify(signal.importerPath.replaceAll('\\', '/'))}`,
    `load: ${loaderBinding}`,
  ].join(', ');
  return `${binding}({ ${metadata} });`;
}

/** Removes repeated evidence from one source while retaining its first stable syntax position. */
function deduplicateSignals(signals: readonly PreviewStyleSignal[]): readonly PreviewStyleSignal[] {
  const uniqueSignals = new Map<string, PreviewStyleSignal>();
  for (const signal of signals) {
    const key = JSON.stringify([
      signal.importerPath,
      signal.moduleSpecifier,
      signal.exportName,
      signal.confidence,
    ]);
    if (!uniqueSignals.has(key)) {
      uniqueSignals.set(key, signal);
    }
  }
  return [...uniqueSignals.values()];
}

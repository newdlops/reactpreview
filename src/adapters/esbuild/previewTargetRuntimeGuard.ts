/**
 * Rejects target modules that are statically proven to belong to a non-React rendering runtime.
 * The guard is intentionally inert: it parses the current editor text and reads normalized
 * dependency/configuration evidence, but never resolves packages or executes project code.
 */
import path from 'node:path';
import ts from 'typescript';
import {
  PreviewCompilationError,
  type PreviewBuildRequest,
  type PreviewDiagnosticLocation,
} from '../../domain/preview';
import {
  findPreviewDependencySpecifier,
  type PreviewDependencyProfile,
} from '../node/previewDependencyProfile';
import type { PreviewStaticModuleResolver } from './previewStaticModuleResolver';

/** Static inputs available before esbuild evaluates any target module. */
export interface PreviewTargetRuntimeGuardOptions {
  /** Inert nearest-package declarations used to distinguish a dedicated app from a hybrid. */
  readonly dependencyProfile: PreviewDependencyProfile | undefined;
  /** Absolute editor identity reported in structured diagnostics. */
  readonly documentPath: string;
  /** Current editor text, including unsaved imports and JSX pragmas. */
  readonly sourceText: string;
  /** Exact and broad JSX ownership evidence from the nearest trusted TypeScript configuration. */
  readonly staticModuleResolver: Pick<
    PreviewStaticModuleResolver,
    'getJsxImportSource' | 'usesAlternativeJsxRuntime'
  >;
}

/** One runtime-valued package reference and its exact source position. */
interface RuntimeModuleReference {
  readonly location: PreviewDiagnosticLocation;
  readonly moduleSpecifier: string;
}

/** Proof sufficient to stop React compilation without guessing from a package name alone. */
interface UnsupportedTargetRuntimeEvidence {
  readonly description: string;
  readonly displayName: 'Lit' | 'SolidJS';
  readonly location: PreviewDiagnosticLocation;
  readonly moduleSpecifier: string;
  readonly note: string;
}

/** Solid's package root and every runtime/compiler subpath share this exact identity boundary. */
const SOLID_PACKAGE_NAME = 'solid-js';

/** Lit supports both the modern aggregate package and the lower-level template runtime package. */
const LIT_PACKAGE_NAMES = ['lit', 'lit-html'] as const;

/**
 * Adapts the compiler's existing request/profile boundaries to the focused assertion contract.
 * Keeping this convenience entry here leaves orchestration free from framework classification.
 */
export function assertPreviewReactTarget(
  request: Pick<PreviewBuildRequest, 'documentPath' | 'sourceText'>,
  dependencyProfile: PreviewDependencyProfile | undefined,
  staticModuleResolver: PreviewTargetRuntimeGuardOptions['staticModuleResolver'],
): void {
  assertPreviewTargetUsesSupportedReactRuntime({
    dependencyProfile,
    documentPath: request.documentPath,
    sourceText: request.sourceText,
    staticModuleResolver,
  });
}

/**
 * Fails before bundling when the selected file cannot produce a React element by construction.
 * Merely declaring another UI package is never enough. The target must import that runtime, and a
 * React+auxiliary hybrid fails open unless the file also selects Solid's compiler or bootstraps its
 * renderer. This keeps React components that use `createSignal` as a helper previewable.
 *
 * @param options Current source plus inert manifest and TypeScript configuration evidence.
 * @throws PreviewCompilationError with a source-backed diagnostic for a proven unsupported target.
 */
export function assertPreviewTargetUsesSupportedReactRuntime(
  options: PreviewTargetRuntimeGuardOptions,
): void {
  const evidence = findUnsupportedTargetRuntime(options);
  if (evidence === undefined) return;

  const fileName = path.basename(options.documentPath);
  const summary = `${fileName} is a ${evidence.displayName} target, not a React component.`;
  throw new PreviewCompilationError(
    `React Preview cannot render ${fileName} because it is a ${evidence.displayName} target, not a React component.`,
    [
      {
        location: evidence.location,
        message: `${summary} ${evidence.description}`,
        notes: [
          evidence.note,
          "Installing the missing package alone cannot change the target's rendering semantics.",
          'React File Preview renders React elements; open this source with its framework-native preview tooling.',
        ],
        severity: 'error',
      },
    ],
  );
}

/** Combines direct source use with package/config ownership, returning no result when ambiguous. */
function findUnsupportedTargetRuntime(
  options: PreviewTargetRuntimeGuardOptions,
): UnsupportedTargetRuntimeEvidence | undefined {
  const sourceFile = createTargetSourceFile(options.documentPath, options.sourceText);
  const references = collectRuntimeModuleReferences(sourceFile, options.documentPath);
  const solidCompilerEvidence = findSolidJsxCompilerEvidence(options, sourceFile);
  const solidReference = references.find(({ moduleSpecifier }) =>
    isPackageOrSubpath(moduleSpecifier, SOLID_PACKAGE_NAME),
  );
  if (
    solidReference !== undefined &&
    (solidCompilerEvidence !== undefined || targetIsProvenSolid(options, solidReference))
  ) {
    return {
      description: `It imports "${solidReference.moduleSpecifier}" as a runtime dependency.`,
      displayName: 'SolidJS',
      location: solidReference.location,
      moduleSpecifier: solidReference.moduleSpecifier,
      note: 'SolidJS JSX requires vite-plugin-solid (or an equivalent Solid compiler transform) before it can run.',
    };
  }
  if (solidCompilerEvidence !== undefined) {
    return {
      description: `Its JSX compiler is explicitly configured to use "${solidCompilerEvidence.moduleSpecifier}".`,
      displayName: 'SolidJS',
      location: solidCompilerEvidence.location,
      moduleSpecifier: solidCompilerEvidence.moduleSpecifier,
      note: 'SolidJS JSX requires vite-plugin-solid (or an equivalent Solid compiler transform) before it can run.',
    };
  }

  const litReference = references.find(({ moduleSpecifier }) =>
    LIT_PACKAGE_NAMES.some((packageName) => isPackageOrSubpath(moduleSpecifier, packageName)),
  );
  if (litReference !== undefined && targetIsProvenLit(options.dependencyProfile)) {
    return {
      description: `It imports "${litReference.moduleSpecifier}" as a runtime dependency.`,
      displayName: 'Lit',
      location: litReference.location,
      moduleSpecifier: litReference.moduleSpecifier,
      note: 'Lit render functions produce TemplateResult values rather than React elements.',
    };
  }
  return undefined;
}

/** Applies strong Solid ownership rules while deliberately allowing ambiguous React hybrids. */
function targetIsProvenSolid(
  options: PreviewTargetRuntimeGuardOptions,
  reference: RuntimeModuleReference,
): boolean {
  if (isPackageOrSubpath(reference.moduleSpecifier, 'solid-js/web')) {
    // Calling Solid's DOM bootstrap is definitive even when a migration manifest also lists React.
    return true;
  }

  const hasSolidRequirement = hasPackageRequirement(options.dependencyProfile, SOLID_PACKAGE_NAME);
  const hasReactRequirement = targetPackageDeclaresReact(options.dependencyProfile);
  return hasSolidRequirement && !hasReactRequirement;
}

/** Finds exact TypeScript-config or leading-pragma ownership even without a framework import. */
function findSolidJsxCompilerEvidence(
  options: PreviewTargetRuntimeGuardOptions,
  sourceFile: ts.SourceFile,
): RuntimeModuleReference | undefined {
  const pragmaEvidence = findLeadingJsxImportSourcePragma(sourceFile, options.documentPath);
  if (pragmaEvidence !== undefined) {
    return isPackageOrSubpath(pragmaEvidence.moduleSpecifier, SOLID_PACKAGE_NAME)
      ? pragmaEvidence
      : undefined;
  }

  const configuredJsxOwner = options.staticModuleResolver.getJsxImportSource(options.documentPath);
  return options.staticModuleResolver.usesAlternativeJsxRuntime(options.documentPath) &&
    configuredJsxOwner !== undefined &&
    isPackageOrSubpath(configuredJsxOwner, SOLID_PACKAGE_NAME)
    ? {
        location: { column: 0, file: options.documentPath, line: 1 },
        moduleSpecifier: configuredJsxOwner,
      }
    : undefined;
}

/** Lit-only package ownership plus a direct runtime import proves TemplateResult semantics. */
function targetIsProvenLit(profile: PreviewDependencyProfile | undefined): boolean {
  return (
    !targetPackageDeclaresReact(profile) &&
    LIT_PACKAGE_NAMES.some((packageName) => hasPackageRequirement(profile, packageName))
  );
}

/** Reports whether any runtime dependency field declares React or its DOM renderer. */
function targetPackageDeclaresReact(profile: PreviewDependencyProfile | undefined): boolean {
  return hasPackageRequirement(profile, 'react') || hasPackageRequirement(profile, 'react-dom');
}

/** Reads one normalized manifest requirement without assigning meaning to its authored range. */
function hasPackageRequirement(
  profile: PreviewDependencyProfile | undefined,
  packageName: string,
): boolean {
  return findPreviewDependencySpecifier(profile, packageName) !== undefined;
}

/** Creates a syntax tree solely to identify module references and leading compiler pragmas. */
function createTargetSourceFile(documentPath: string, sourceText: string): ts.SourceFile {
  const lowerPath = documentPath.toLowerCase();
  const scriptKind = lowerPath.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : lowerPath.endsWith('.ts') || lowerPath.endsWith('.mts') || lowerPath.endsWith('.cts')
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JSX;
  return ts.createSourceFile(documentPath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
}

/** Collects direct ESM, dynamic-import, and CommonJS runtime references in source order. */
function collectRuntimeModuleReferences(
  sourceFile: ts.SourceFile,
  documentPath: string,
): readonly RuntimeModuleReference[] {
  const references: RuntimeModuleReference[] = [];

  /** Adds one string literal with the user-visible position of its module specifier. */
  const addReference = (literal: ts.StringLiteralLike): void => {
    const position = sourceFile.getLineAndCharacterOfPosition(literal.getStart(sourceFile));
    references.push({
      location: { column: position.character, file: documentPath, line: position.line + 1 },
      moduleSpecifier: literal.text,
    });
  };

  /** Visits declarations and call expressions without treating erased type imports as runtime use. */
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      importDeclarationHasRuntimeValue(node)
    ) {
      addReference(node.moduleSpecifier);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      exportDeclarationHasRuntimeValue(node)
    ) {
      addReference(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly) {
      const reference = node.moduleReference;
      if (ts.isExternalModuleReference(reference) && ts.isStringLiteralLike(reference.expression)) {
        addReference(reference.expression);
      }
    } else if (isRuntimeModuleCall(node)) {
      addReference(node.arguments[0] as ts.StringLiteralLike);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

/** Distinguishes side-effect/value imports from declarations erased completely by TypeScript. */
function importDeclarationHasRuntimeValue(declaration: ts.ImportDeclaration): boolean {
  const clause = declaration.importClause;
  if (clause === undefined) return true;
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return false;
  if (clause.name !== undefined || clause.namedBindings === undefined) return true;
  return (
    ts.isNamespaceImport(clause.namedBindings) ||
    clause.namedBindings.elements.some((element) => !element.isTypeOnly)
  );
}

/** Distinguishes value re-exports from `export type` and entirely type-only named clauses. */
function exportDeclarationHasRuntimeValue(declaration: ts.ExportDeclaration): boolean {
  if (declaration.isTypeOnly) return false;
  const clause = declaration.exportClause;
  return (
    clause === undefined ||
    !ts.isNamedExports(clause) ||
    clause.elements.some((element) => !element.isTypeOnly)
  );
}

/** Recognizes only literal `import()` and unshadowed-looking `require()` syntax as module evidence. */
function isRuntimeModuleCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node) || node.arguments.length !== 1) return false;
  const argument = node.arguments[0];
  if (argument === undefined || !ts.isStringLiteralLike(argument)) return false;
  return (
    node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(node.expression) && node.expression.text === 'require')
  );
}

/** Reads only the compiler pragma preamble and retains the pragma value's exact source position. */
function findLeadingJsxImportSourcePragma(
  sourceFile: ts.SourceFile,
  documentPath: string,
): RuntimeModuleReference | undefined {
  const firstStatement = sourceFile.statements[0];
  const preambleEnd = firstStatement?.getStart(sourceFile, false) ?? sourceFile.end;
  const preamble = sourceFile.getFullText().slice(0, preambleEnd);
  for (const match of preamble.matchAll(/@jsxImportSource\s+([^\s*]+)/gu)) {
    const moduleSpecifier = match[1];
    if (moduleSpecifier === undefined) continue;
    const valueOffset = match[0].lastIndexOf(moduleSpecifier);
    const position = sourceFile.getLineAndCharacterOfPosition(match.index + valueOffset);
    return {
      location: { column: position.character, file: documentPath, line: position.line + 1 },
      moduleSpecifier,
    };
  }
  return undefined;
}

/** Matches an npm root exactly or below a slash, never a lookalike prefix such as `solid-jsx`. */
function isPackageOrSubpath(moduleSpecifier: string, packageName: string): boolean {
  return moduleSpecifier === packageName || moduleSpecifier.startsWith(`${packageName}/`);
}

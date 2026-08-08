/**
 * Rewrites selected target variable exports so same-module JSX references use the exact Inspector
 * boundary too. Import facades cannot intercept a lexical reference declared and consumed inside
 * one module, which otherwise makes a visibly rendered local modal appear unmounted.
 */
import path from 'node:path';
import ts from 'typescript';
import {
  applyPreviewSourceReplacements,
  selectCompatiblePreviewSourceReplacements,
  type PreviewSourceReplacement,
} from './previewSourceReplacement';

const PREVIEW_INSPECTOR_API_SYMBOL = 'newdlops.react-file-preview.page-inspector';
const LOCAL_TARGET_BLOCKED_STATICS = [
  '$$typeof',
  '_debugInfo',
  '_init',
  '_payload',
  'arguments',
  'arity',
  'callee',
  'caller',
  'childContextTypes',
  'compare',
  'contextType',
  'contextTypes',
  'defaultProps',
  'displayName',
  'getDefaultProps',
  'getDerivedStateFromError',
  'getDerivedStateFromProps',
  'length',
  'mixins',
  'name',
  'propTypes',
  'prototype',
  'render',
  'type',
] as const;

/** Exact compiler metadata required by the browser-side local target wrapper. */
export interface PreviewLocalTargetExportMetadata {
  readonly compilerExportEvidence: true;
  readonly effectControllerOutputCandidate?: true;
  readonly exportName: string;
  readonly facadeResolutionEvidence: true;
  readonly inferredPropShape?: unknown;
  readonly inferredProps?: unknown;
  readonly intentionalNavigationOutput?: true;
  readonly preparedSourceDigest: string;
  readonly sourcePath: string;
}

/** One target-module rewrite plan supplied by the Page Inspector compiler. */
export interface PreviewLocalTargetExportInstrumentation {
  readonly metadataByExport: Readonly<Record<string, PreviewLocalTargetExportMetadata>>;
  readonly sourcePath: string;
}

/**
 * Wraps direct or locally aliased variable exports without changing their authored initializer.
 *
 * The generated IIFE evaluates the initializer once and falls back to the original value when the
 * Inspector API is unavailable. Function/class declarations remain untouched because rebinding a
 * hoisted declaration would change module initialization semantics.
 */
export function instrumentPreviewLocalTargetExportBindings(
  sourcePath: string,
  sourceText: string,
  plan: PreviewLocalTargetExportInstrumentation | undefined,
): string {
  if (
    plan === undefined ||
    path.normalize(sourcePath) !== path.normalize(plan.sourcePath) ||
    Object.keys(plan.metadataByExport).length === 0
  ) {
    return sourceText;
  }
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectScriptKind(sourcePath),
  );
  if (
    (sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics?.length !== 0
  ) {
    return sourceText;
  }

  const publicNamesByLocalName = collectSelectedPublicNamesByLocalName(
    sourceFile,
    new Set(Object.keys(plan.metadataByExport)),
  );
  const replacements: PreviewSourceReplacement[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const publicNames = publicNamesByLocalName.get(declaration.name.text) ?? [];
      if (publicNames.length !== 1) continue;
      const metadata = plan.metadataByExport[publicNames[0] ?? ''];
      if (metadata === undefined) continue;
      const start = declaration.initializer.getStart(sourceFile);
      const end = declaration.initializer.end;
      const initializer = sourceFile.text.slice(start, end);
      replacements.push({
        end,
        replacement: createLocalTargetWrapperExpression(initializer, metadata),
        start,
      });
    }
  }
  return replacements.length === 0
    ? sourceText
    : applyPreviewSourceReplacements(
        sourceText,
        selectCompatiblePreviewSourceReplacements(replacements),
      );
}

/**
 * Creates a late-binding forward-ref object when static ESM evaluation precedes Inspector setup.
 * React invokes its render only after the entry has installed the API, so no project component is
 * called as an ordinary function and hook semantics stay intact.
 */
function createLocalTargetWrapperExpression(
  initializer: string,
  metadata: PreviewLocalTargetExportMetadata,
): string {
  const api = `globalThis[Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_API_SYMBOL)})]`;
  return (
    '((__reactPreviewLocalTarget, __reactPreviewLocalMetadata) => {' +
    `const __reactPreviewApi = ${api};` +
    'if (typeof __reactPreviewApi?.wrapLocalTarget === "function") {' +
    'return __reactPreviewApi.wrapLocalTarget(__reactPreviewLocalTarget, __reactPreviewLocalMetadata);' +
    '}' +
    'if ((__reactPreviewLocalTarget === null) || ' +
    '(typeof __reactPreviewLocalTarget !== "object" && ' +
    'typeof __reactPreviewLocalTarget !== "function")) return __reactPreviewLocalTarget;' +
    'const __reactPreviewDeferredTarget = {' +
    '$$typeof: Symbol.for("react.forward_ref"),' +
    'render: (__reactPreviewProps, __reactPreviewRef) => ' +
    `${api}?.createLocalTargetElement?.(` +
    '__reactPreviewLocalTarget, __reactPreviewLocalMetadata, ' +
    '__reactPreviewProps, __reactPreviewRef) ?? null' +
    '};' +
    '__reactPreviewDeferredTarget.displayName = ' +
    '"ReactPreviewInspectorDeferred(" + __reactPreviewLocalMetadata.exportName + ")";' +
    `const __reactPreviewBlockedStatics = new Set(${JSON.stringify(LOCAL_TARGET_BLOCKED_STATICS)});` +
    'for (const __reactPreviewStaticName of Reflect.ownKeys(__reactPreviewLocalTarget)) {' +
    'if (__reactPreviewBlockedStatics.has(__reactPreviewStaticName)) continue;' +
    'try {' +
    'const __reactPreviewStaticDescriptor = Object.getOwnPropertyDescriptor(' +
    '__reactPreviewLocalTarget, __reactPreviewStaticName);' +
    'if (__reactPreviewStaticDescriptor !== undefined) Object.defineProperty(' +
    '__reactPreviewDeferredTarget, __reactPreviewStaticName, __reactPreviewStaticDescriptor);' +
    '} catch {}' +
    '}' +
    'return __reactPreviewDeferredTarget;' +
    `})(${initializer}, ${JSON.stringify(metadata)})`
  );
}

/** Maps each selected public export to its exact local binding without following re-exports. */
function collectSelectedPublicNamesByLocalName(
  sourceFile: ts.SourceFile,
  selectedPublicNames: ReadonlySet<string>,
): ReadonlyMap<string, readonly string[]> {
  const publicNamesByLocalName = new Map<string, string[]>();
  const append = (localName: string, publicName: string): void => {
    if (!selectedPublicNames.has(publicName)) return;
    const names = publicNamesByLocalName.get(localName) ?? [];
    if (!names.includes(publicName)) names.push(publicName);
    publicNamesByLocalName.set(localName, names);
  };
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) append(declaration.name.text, declaration.name.text);
      }
      continue;
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const specifier of statement.exportClause.elements) {
        if (specifier.isTypeOnly) continue;
        append((specifier.propertyName ?? specifier.name).text, specifier.name.text);
      }
    }
  }
  return publicNamesByLocalName;
}

/** Detects only an explicit value export modifier on the containing variable statement. */
function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
}

/** Chooses parser grammar from the actual module extension. */
function selectScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

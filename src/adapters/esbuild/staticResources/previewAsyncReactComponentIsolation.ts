/**
 * Adapts source-proven nested async React components to a stable client Suspense contract.
 *
 * Server renderers may invoke an `async` component directly, while a browser-only React renderer
 * sees a fresh Promise on every retry and can enter an unbounded suspension loop. This transform
 * keeps the authored body intact inside one async loader, but exposes a synchronous component that
 * throws the same bounded thenable until the loader resolves. Resolved JSX is returned unchanged;
 * rejection or timeout produces only a compact inline marker at that component boundary.
 *
 * Admission is intentionally narrow: a top-level PascalCase async declaration must own a JSX
 * return and another declaration in the same module must render its exact local JSX tag. Route
 * roots, exported-only components, aliases, HOCs, helpers, generators, and `use client` modules
 * therefore fail closed. The adapter runs after all source-position-based instrumentation.
 */
import path from 'node:path';
import ts from 'typescript';
import {
  applyPreviewSourceReplacements,
  selectCompatiblePreviewSourceReplacements,
  type PreviewSourceReplacement,
} from './previewSourceReplacement';
import { selectPreviewRuntimeScriptKind } from './previewRuntimeHookSyntax';

/** Host attribute available to Inspector and runtime regression probes. */
export const PREVIEW_ASYNC_COMPONENT_ATTRIBUTE = 'data-react-preview-async-component';

/** Keeps one generated module from accumulating an unbounded Suspense record catalog. */
const MAX_ASYNC_COMPONENT_ISOLATIONS_PER_MODULE = 32;

/** Client preview wait after which a never-settling server body becomes a visible local marker. */
const PREVIEW_ASYNC_COMPONENT_TIMEOUT_MS = 1_500;

/** Conventional local React component identity admitted by this source-only analysis. */
const REACT_COMPONENT_NAME_PATTERN = /^[A-Z][A-Za-z0-9_$]*$/u;

/** Static function shape whose body can be wrapped without changing its public declaration. */
interface PreviewAsyncComponentCandidate {
  /** Explicit async token replaced with spaces to preserve authored line and column offsets. */
  readonly asyncModifier: ts.Modifier;
  /** Block or concise body moved unchanged into the one-shot async loader. */
  readonly body: ts.ConciseBody;
  /** PascalCase identity used as the stable record key and compact marker label. */
  readonly componentName: string;
  /** Declaration excluded while searching for a distinct JSX render owner. */
  readonly declaration: ts.Node;
  /** Function identity used to exclude self-recursive contracts from automatic adaptation. */
  readonly functionNode: ts.FunctionLikeDeclaration;
}

/**
 * Wraps locally rendered async components with stable thenables at the final source stage.
 *
 * @param sourcePath Absolute workspace path used only to choose TypeScript's parser grammar.
 * @param sourceText Source after ordinary condition, trigger, effect, and request instrumentation.
 * @returns Original source when evidence is insufficient, otherwise an adapted browser copy.
 */
export function isolatePreviewAsyncReactComponents(sourcePath: string, sourceText: string): string {
  if (
    !isJavaScriptLikeSource(sourcePath) ||
    !sourceText.includes('async') ||
    !sourceText.includes('<')
  ) {
    return sourceText;
  }
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectPreviewRuntimeScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile) || hasUseClientDirective(sourceFile)) return sourceText;

  const defaultExportedNames = collectDefaultExportedNames(sourceFile);
  const candidates = collectAsyncComponentCandidates(sourceFile)
    .filter(
      (candidate) =>
        !defaultExportedNames.has(candidate.componentName) &&
        !containsSelfReference(candidate) &&
        hasDistinctLocalJsxUsage(sourceFile, candidate),
    )
    .slice(0, MAX_ASYNC_COMPONENT_ISOLATIONS_PER_MODULE);
  if (candidates.length === 0) return sourceText;

  const helperName = allocateGeneratedBinding(sourceText, '__reactPreviewReadAsyncComponent');
  const recordsName = allocateGeneratedBinding(sourceText, '__reactPreviewAsyncComponentRecords');
  const replacements = candidates.flatMap((candidate, index) =>
    createCandidateReplacements(candidate, sourceFile, sourceText, helperName, index),
  );
  const transformed = applyPreviewSourceReplacements(
    sourceText,
    selectCompatiblePreviewSourceReplacements(replacements),
  );
  return `${transformed}${transformed.endsWith('\n') ? '' : '\n'}${createAsyncRuntimeSource(helperName, recordsName)}\n`;
}

/** Collects direct declarations only; nested callbacks and HOC arguments are never candidates. */
function collectAsyncComponentCandidates(
  sourceFile: ts.SourceFile,
): readonly PreviewAsyncComponentCandidate[] {
  const candidates: PreviewAsyncComponentCandidate[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      const candidate = createFunctionCandidate(statement);
      if (candidate !== undefined) candidates.push(candidate);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const candidate = createVariableCandidate(declaration);
      if (candidate !== undefined) candidates.push(candidate);
    }
  }
  return candidates;
}

/** Proves a named async function declaration owns JSX on one of its direct return paths. */
function createFunctionCandidate(
  declaration: ts.FunctionDeclaration,
): PreviewAsyncComponentCandidate | undefined {
  const componentName = declaration.name?.text;
  const asyncModifier = readAsyncModifier(declaration);
  if (
    componentName === undefined ||
    !REACT_COMPONENT_NAME_PATTERN.test(componentName) ||
    declaration.body === undefined ||
    declaration.asteriskToken !== undefined ||
    asyncModifier === undefined ||
    !functionOwnReturnContainsJsx(declaration, declaration.body)
  ) {
    return undefined;
  }
  return {
    asyncModifier,
    body: declaration.body,
    componentName,
    declaration,
    functionNode: declaration,
  };
}

/** Proves a PascalCase variable directly contains an async arrow or function expression. */
function createVariableCandidate(
  declaration: ts.VariableDeclaration,
): PreviewAsyncComponentCandidate | undefined {
  if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) return undefined;
  const componentName = declaration.name.text;
  const initializer = declaration.initializer;
  if (
    !REACT_COMPONENT_NAME_PATTERN.test(componentName) ||
    (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer)) ||
    initializer.asteriskToken !== undefined
  ) {
    return undefined;
  }
  const asyncModifier = readAsyncModifier(initializer);
  if (asyncModifier === undefined || !functionOwnReturnContainsJsx(initializer, initializer.body)) {
    return undefined;
  }
  return {
    asyncModifier,
    body: initializer.body,
    componentName,
    declaration,
    functionNode: initializer,
  };
}

/** Reads an actual modifier token while excluding decorators from TypeScript's ModifierLike set. */
function readAsyncModifier(node: ts.Node): ts.Modifier | undefined {
  return ts.canHaveModifiers(node)
    ? ts.getModifiers(node)?.find((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
    : undefined;
}

/** Keeps explicit client modules under their authored compiler/runtime contract. */
function hasUseClientDirective(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression) &&
      statement.expression.text === 'use client',
  );
}

/** Protects direct and aliased default exports, which may be framework-owned route roots. */
function collectDefaultExportedNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name !== undefined &&
      hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
    ) {
      names.add(statement.name.text);
      continue;
    }
    if (
      ts.isExportAssignment(statement) &&
      !statement.isExportEquals &&
      ts.isIdentifier(statement.expression)
    ) {
      names.add(statement.expression.text);
      continue;
    }
    if (
      !ts.isExportDeclaration(statement) ||
      statement.exportClause === undefined ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      continue;
    }
    for (const element of statement.exportClause.elements) {
      if (element.name.text === 'default' && element.propertyName !== undefined) {
        names.add(element.propertyName.text);
      }
    }
  }
  return names;
}

/** Reports whether one declaration carries a concrete syntax modifier. */
function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((item) => item.kind === kind) === true
  );
}

/** Excludes recursive async render contracts whose rewritten self-call could change semantics. */
function containsSelfReference(candidate: PreviewAsyncComponentCandidate): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || (node !== candidate.functionNode && ts.isFunctionLike(node))) return;
    if (ts.isIdentifier(node) && node.text === candidate.componentName) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(candidate.body);
  return found;
}

/** Requires an exact local JSX tag in a different top-level render owner. */
function hasDistinctLocalJsxUsage(
  sourceFile: ts.SourceFile,
  candidate: PreviewAsyncComponentCandidate,
): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || node === candidate.declaration) return;
    const tagName = ts.isJsxSelfClosingElement(node)
      ? node.tagName
      : ts.isJsxOpeningElement(node)
        ? node.tagName
        : undefined;
    if (
      tagName !== undefined &&
      ts.isIdentifier(tagName) &&
      tagName.text === candidate.componentName
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * Proves JSX belongs to the candidate's own return contract.
 * Nested function-like bodies are skipped, so callback JSX never promotes a data helper.
 */
function functionOwnReturnContainsJsx(
  owner: ts.FunctionLikeDeclaration,
  body: ts.ConciseBody,
): boolean {
  if (!ts.isBlock(body)) return expressionContainsJsx(body);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || (node !== owner && ts.isFunctionLike(node))) return;
    if (
      ts.isReturnStatement(node) &&
      node.expression !== undefined &&
      expressionContainsJsx(node.expression)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

/** Detects JSX inside one returned expression while excluding JSX in nested callbacks. */
function expressionContainsJsx(expression: ts.Expression): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || (node !== expression && ts.isFunctionLike(node))) return;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return found;
}

/** Creates space-preserving async removal plus a body-local one-shot loader wrapper. */
function createCandidateReplacements(
  candidate: PreviewAsyncComponentCandidate,
  sourceFile: ts.SourceFile,
  sourceText: string,
  helperName: string,
  index: number,
): readonly PreviewSourceReplacement[] {
  const bodyStart = candidate.body.getStart(sourceFile);
  const fallback = createCompactFallbackExpression(candidate.componentName);
  const key = JSON.stringify(`${index.toString()}:${candidate.componentName}`);
  const loader = ts.isBlock(candidate.body)
    ? `async()=>{${sourceText.slice(bodyStart + 1, candidate.body.end - 1)}}`
    : `async()=>(${sourceText.slice(bodyStart, candidate.body.end)})`;
  const replacement = ts.isBlock(candidate.body)
    ? `{return ${helperName}(${key},${loader},${fallback});}`
    : `${helperName}(${key},${loader},${fallback})`;
  return [
    {
      end: candidate.asyncModifier.end,
      replacement: ' '.repeat(
        candidate.asyncModifier.end - candidate.asyncModifier.getStart(sourceFile),
      ),
      start: candidate.asyncModifier.getStart(sourceFile),
    },
    { end: candidate.body.end, replacement, start: bodyStart },
  ];
}

/** Emits a one-character inline marker that cannot widen a compact header or link slot. */
function createCompactFallbackExpression(componentName: string): string {
  const label = JSON.stringify(componentName);
  const title = JSON.stringify(
    `${componentName}: async server output unavailable in static preview`,
  );
  return [
    `(<span ${PREVIEW_ASYNC_COMPONENT_ATTRIBUTE}=${label}`,
    ' data-react-preview-source-isolated="async-component" role="status"',
    ` aria-label=${title} title=${title}`,
    ' style={{display:"inline-block",minWidth:"1em",textAlign:"center",opacity:0.65}}>…</span>)',
  ].join('');
}

/** Appends one bounded state machine shared by all adapted components in the module. */
function createAsyncRuntimeSource(helperName: string, recordsName: string): string {
  return [
    `const ${recordsName}=new Map();`,
    `function ${helperName}(key,load,fallback){`,
    `let record=${recordsName}.get(key);`,
    'if(record===undefined){',
    'let resume;',
    'const promise=new Promise((resolve)=>{resume=resolve;});',
    "record={promise,status:'pending',value:fallback};",
    `${recordsName}.set(key,record);`,
    'let timer;',
    'const settle=(value,reason)=>{',
    "if(record.status!=='pending')return;",
    'if(timer!==undefined)clearTimeout(timer);',
    "record.status='fulfilled';",
    'record.value=value==null?fallback:value;',
    'if(reason!==undefined){',
    'const detail=String(reason?.message??reason).slice(0,240);',
    "globalThis.console?.warn?.('[React Preview] '+key+' '+detail);",
    '}',
    'resume();',
    '};',
    `timer=setTimeout(()=>settle(fallback,'timed out after ${PREVIEW_ASYNC_COMPONENT_TIMEOUT_MS.toString()}ms'),${PREVIEW_ASYNC_COMPONENT_TIMEOUT_MS.toString()});`,
    'Promise.resolve().then(load).then((value)=>settle(value),(error)=>settle(fallback,error));',
    '}',
    "if(record.status==='pending')throw record.promise;",
    'return record.value;',
    '}',
  ].join('\n');
}

/** Allocates a deterministic generated binding without colliding with authored identifiers. */
function allocateGeneratedBinding(sourceText: string, baseName: string): string {
  let candidate = baseName;
  while (sourceText.includes(candidate)) {
    candidate += '$';
  }
  return candidate;
}

/** Keeps parser admission aligned with workspace JavaScript-like loaders. */
function isJavaScriptLikeSource(sourcePath: string): boolean {
  return /\.[cm]?[jt]sx?$/iu.test(path.extname(sourcePath));
}

/** Fails closed when TypeScript recovered an incomplete dirty-editor snapshot. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  return (
    ((sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics?.length ?? 0) > 0
  );
}

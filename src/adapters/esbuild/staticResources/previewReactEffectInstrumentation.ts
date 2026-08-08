/**
 * Isolates failures from React effects that do not own the component's rendered output.
 *
 * Page Inspector executes real application shells, where analytics, websocket registration,
 * persistence, and native bridges commonly run from effects. A synchronous failure in one such
 * effect makes React unmount an otherwise valid page. This transform wraps only callbacks passed
 * to effect hooks proven to come from React; component render functions and arbitrary project
 * callbacks remain untouched.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import {
  applyPreviewSourceReplacements,
  selectCompatiblePreviewSourceReplacements,
  type PreviewSourceReplacement,
} from './previewSourceReplacement';

const EFFECT_HOOK_NAMES = new Set(['useEffect', 'useInsertionEffect', 'useLayoutEffect']);
const PREVIEW_INSPECTOR_API =
  "globalThis[Symbol.for('newdlops.react-file-preview.page-inspector')]";

/** Imported React bindings that prove an effect call without evaluating the source module. */
interface PreviewReactEffectBindings {
  /** Aliased named imports mapped back to their canonical hook names. */
  readonly direct: ReadonlyMap<string, string>;
  /** Default and namespace imports whose effect members are safe to recognize. */
  readonly namespaces: ReadonlySet<string>;
}

/**
 * Wraps React effect callbacks with the Page Inspector's render-only side-effect boundary.
 *
 * @param sourcePath Absolute project source used for parser mode, diagnostics, and stable ids.
 * @param sourceText Source after other preview compatibility transforms have completed.
 * @returns Equivalent source whose proven React effects cannot unmount a static page in Auto mode.
 */
export function instrumentPreviewReactEffects(sourcePath: string, sourceText: string): string {
  if (
    !sourceText.includes('useEffect') &&
    !sourceText.includes('useInsertionEffect') &&
    !sourceText.includes('useLayoutEffect')
  ) {
    return sourceText;
  }
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    readScriptKind(sourcePath),
  );
  const bindings = collectPreviewReactEffectBindings(sourceFile);
  if (bindings.direct.size === 0 && bindings.namespaces.size === 0) return sourceText;
  const replacements: PreviewSourceReplacement[] = [];

  /** Visits effect calls while keeping nested JSX and ordinary callbacks inert. */
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const hookName = readPreviewReactEffectHookName(node.expression, bindings);
      const callback = node.arguments[0];
      if (hookName !== undefined && callback !== undefined && !ts.isSpreadElement(callback)) {
        replacements.push(
          createPreviewReactEffectCallbackReplacement(
            sourcePath,
            sourceText,
            sourceFile,
            node,
            callback,
            hookName,
          ),
        );
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return applyPreviewSourceReplacements(
    sourceText,
    selectCompatiblePreviewSourceReplacements(replacements),
  );
}

/** Collects named, namespace, and default bindings from the exact `react` module only. */
function collectPreviewReactEffectBindings(sourceFile: ts.SourceFile): PreviewReactEffectBindings {
  const direct = new Map<string, string>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'react'
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause?.name !== undefined) namespaces.add(clause.name.text);
    const bindings = clause?.namedBindings;
    if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
    } else if (bindings !== undefined) {
      for (const element of bindings.elements) {
        const importedName = element.propertyName?.text ?? element.name.text;
        if (EFFECT_HOOK_NAMES.has(importedName)) direct.set(element.name.text, importedName);
      }
    }
  }
  return { direct, namespaces };
}

/** Maps a call target to a React effect hook only through a proven import binding. */
function readPreviewReactEffectHookName(
  expression: ts.LeftHandSideExpression,
  bindings: PreviewReactEffectBindings,
): string | undefined {
  if (ts.isIdentifier(expression)) return bindings.direct.get(expression.text);
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    bindings.namespaces.has(expression.expression.text) &&
    EFFECT_HOOK_NAMES.has(expression.name.text)
  ) {
    return expression.name.text;
  }
  return undefined;
}

/** Creates one callback-only rewrite so effect dependency arrays stay byte-for-byte authored. */
function createPreviewReactEffectCallbackReplacement(
  sourcePath: string,
  sourceText: string,
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  callback: ts.Expression,
  hookName: string,
): PreviewSourceReplacement {
  const start = callback.getStart(sourceFile);
  const location = sourceFile.getLineAndCharacterOfPosition(call.getStart(sourceFile));
  const metadata = {
    column: location.character + 1,
    evidence: 'React effect failure does not own rendered page output',
    hookName,
    id: createPreviewReactEffectIdentity(sourcePath, hookName, call.getStart(sourceFile)),
    line: location.line + 1,
    ownerName: readPreviewReactEffectOwnerName(call),
    requiredPaths: [],
    sourcePath: path.normalize(sourcePath),
  };
  const originalCallback = instrumentPreviewReactEffectEventListeners(
    sourcePath,
    sourceText,
    sourceFile,
    call,
    callback,
    metadata,
  );
  const apiBinding = '__reactPreviewEffectApi';
  const argumentBinding = '__reactPreviewEffectArguments';
  const ownershipBinding = '__reactPreviewEffectOwnership';
  return {
    end: callback.end,
    replacement: [
      '(() => {',
      `const ${apiBinding} = ${PREVIEW_INSPECTOR_API};`,
      `const ${ownershipBinding} = typeof ${apiBinding}?.useTargetOwnershipToken === 'function' ? ${apiBinding}.useTargetOwnershipToken() : undefined;`,
      `return (...${argumentBinding}) => {`,
      `return typeof ${apiBinding}?.resolveRuntimeEffect === 'function'`,
      `? ${apiBinding}.resolveRuntimeEffect(() => (${originalCallback})(...${argumentBinding}), ${JSON.stringify(metadata)}, ${ownershipBinding})`,
      `: (${originalCallback})(...${argumentBinding});`,
      '};',
      '})()',
    ].join(' '),
    start,
  };
}

/**
 * Instruments only paired positive-overlay emitter subscriptions inside one proven React effect.
 * The generated closures evaluate each authored emitter/event/listener expression once, preserve
 * the original listener object, and return precisely what the authored emitter call returned.
 */
function instrumentPreviewReactEffectEventListeners(
  sourcePath: string,
  sourceText: string,
  sourceFile: ts.SourceFile,
  effectCall: ts.CallExpression,
  callback: ts.Expression,
  effectMetadata: Record<string, unknown>,
): string {
  const callbackStart = callback.getStart(sourceFile);
  const callbackText = sourceText.slice(callbackStart, callback.end);
  const subscriptions: Array<{ call: ts.CallExpression; event: ts.Expression; listener: ts.Expression; emitter: ts.Expression }> = [];
  const cleanups: Array<{ call: ts.CallExpression; event: ts.Expression; listener: ts.Expression; emitter: ts.Expression }> = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const emitterCall = readPreviewReactEffectEmitterCall(node);
      if (emitterCall !== undefined && hasPreviewPositiveOverlayEventSemantics(emitterCall.event, sourceText, sourceFile)) {
        (emitterCall.method === 'on' || emitterCall.method === 'addListener' ? subscriptions : cleanups).push({
          call: node,
          emitter: emitterCall.emitter,
          event: emitterCall.event,
          listener: emitterCall.listener,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(callback);
  const replacements: PreviewSourceReplacement[] = [];
  for (const subscription of subscriptions) {
    const cleanup = cleanups.find((candidate) =>
      previewReactEffectExpressionKey(candidate.emitter, sourceText, sourceFile) ===
        previewReactEffectExpressionKey(subscription.emitter, sourceText, sourceFile) &&
      previewReactEffectExpressionKey(candidate.event, sourceText, sourceFile) ===
        previewReactEffectExpressionKey(subscription.event, sourceText, sourceFile) &&
      previewReactEffectExpressionKey(candidate.listener, sourceText, sourceFile) ===
        previewReactEffectExpressionKey(subscription.listener, sourceText, sourceFile),
    );
    if (cleanup === undefined) continue;
    const occurrenceId = createPreviewReactEffectIdentity(sourcePath, 'event-listener', subscription.call.getStart(sourceFile));
    const eventMetadata = {
      ...effectMetadata,
      eventName: sourceText.slice(subscription.event.getStart(sourceFile), subscription.event.end).slice(0, 160),
      id: occurrenceId,
      occurrenceId,
    };
    replacements.push(
      createPreviewReactEffectEmitterReplacement(subscription, callbackStart, eventMetadata, true),
      createPreviewReactEffectEmitterReplacement(cleanup, callbackStart, eventMetadata, false),
    );
  }
  return applyPreviewSourceReplacements(
    callbackText,
    selectCompatiblePreviewSourceReplacements(replacements),
  );
}

function readPreviewReactEffectEmitterCall(call: ts.CallExpression):
  | { emitter: ts.Expression; event: ts.Expression; listener: ts.Expression; method: 'on' | 'addListener' | 'off' | 'removeListener' }
  | undefined {
  if (!ts.isPropertyAccessExpression(call.expression) || call.arguments.length < 2) return undefined;
  const method = call.expression.name.text;
  if (method !== 'on' && method !== 'addListener' && method !== 'off' && method !== 'removeListener') return undefined;
  const [event, listener] = call.arguments;
  if (event === undefined || listener === undefined || ts.isSpreadElement(event) || ts.isSpreadElement(listener)) return undefined;
  return { emitter: call.expression.expression, event, listener, method };
}

/** Positive activation names must also name an overlay surface; close and generic events fail closed. */
function hasPreviewPositiveOverlayEventSemantics(
  event: ts.Expression,
  sourceText: string,
  sourceFile: ts.SourceFile,
): boolean {
  const normalized = sourceText
    .slice(event.getStart(sourceFile), event.end)
    .replace(/[^a-z]/giu, '')
    .toLowerCase();
  return /show|open|present/u.test(normalized) && /modal|dialog|drawer|overlay|popover|sheet|toast/u.test(normalized);
}

function previewReactEffectExpressionKey(node: ts.Expression, sourceText: string, sourceFile: ts.SourceFile): string {
  return sourceText.slice(node.getStart(sourceFile), node.end).replace(/\s+/gu, '');
}

function createPreviewReactEffectEmitterReplacement(
  entry: { call: ts.CallExpression; emitter: ts.Expression; event: ts.Expression; listener: ts.Expression },
  callbackStart: number,
  metadata: Record<string, unknown>,
  registration: boolean,
): PreviewSourceReplacement {
  const callStart = entry.call.getStart();
  const callEnd = entry.call.end;
  const emitterText = entry.emitter.getText();
  const eventText = entry.event.getText();
  const listenerText = entry.listener.getText();
  const method = (entry.call.expression as ts.PropertyAccessExpression).name.text;
  const apiMethod = registration ? 'registerLocalUiEventListener' : 'unregisterLocalUiEventListener';
  return {
    end: callEnd - callbackStart,
    replacement: [
      '((__previewEmitter, __previewEvent, __previewListener) => {',
      `const __previewResult = __previewEmitter.${method}(__previewEvent, __previewListener);`,
      `const __previewApi = ${PREVIEW_INSPECTOR_API};`,
      `if (typeof __previewApi?.${apiMethod} === 'function') __previewApi.${apiMethod}(${JSON.stringify(metadata)}, __previewEmitter, __previewEvent, __previewListener);`,
      'return __previewResult;',
      `})(${emitterText}, ${eventText}, ${listenerText})`,
    ].join(' '),
    start: callStart - callbackStart,
  };
}

/** Finds the nearest authored function/declaration label for Inspector console attribution. */
function readPreviewReactEffectOwnerName(node: ts.Node): string | undefined {
  let current = node.parent;
  while (current !== node.getSourceFile()) {
    if (
      (ts.isFunctionDeclaration(current) || ts.isClassDeclaration(current)) &&
      current.name !== undefined
    ) {
      return current.name.text;
    }
    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      current.initializer !== undefined
    ) {
      return current.name.text;
    }
    if (ts.isMethodDeclaration(current)) {
      return readStaticPropertyName(current.name);
    }
    current = current.parent;
  }
  return undefined;
}

/** Reads ordinary method names without evaluating computed project expressions. */
function readStaticPropertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

/** Produces a stable source-semantic identity retained across hot rebuilds. */
function createPreviewReactEffectIdentity(
  sourcePath: string,
  hookName: string,
  occurrenceStart: number,
): string {
  return createHash('sha256')
    .update(JSON.stringify([path.normalize(sourcePath), hookName, occurrenceStart]))
    .digest('hex')
    .slice(0, 24);
}

/** Selects TSX/JSX parsing only for extensions that admit JSX syntax. */
function readScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

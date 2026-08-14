/** Adapts the legacy nbind caller generator used by yoga-layout-prebuilt to strict webview CSP. */
import path from 'node:path';
import type { OnLoadResult, Plugin } from 'esbuild';
import ts from 'typescript';
import { applyPreviewSourceReplacements } from './staticResources/previewSourceReplacement';

const MAXIMUM_NBIND_SOURCE_BYTES = 1024 * 1024;
const NBIND_FILE_FILTER = /nbind\.js$/;
const NBIND_PACKAGE_SUFFIX = path.join(
  'node_modules',
  'yoga-layout-prebuilt',
  'yoga-layout',
  'build',
  'Release',
  'nbind.js',
);
const GENERATED_PREFIX = '__reactPreviewNbind';

/** Source reader shared with compiler-lifetime disk and Yarn zip analysis caches. */
export interface PreviewLegacyNbindCspPluginOptions {
  readonly readSource: (options: {
    readonly maximumBytes: number;
    readonly sourcePath: string;
  }) => Promise<string | undefined>;
}

/** Exact syntax nodes whose dynamic source generators have CSP-safe direct equivalents. */
interface LegacyNbindSyntax {
  readonly buildCaller: ts.FunctionDeclaration;
  readonly buildJsCaller: ts.FunctionDeclaration;
  readonly cwrap: ts.FunctionExpression;
  readonly getCFunc: ts.FunctionDeclaration;
  readonly sourceFile: ts.SourceFile;
}

/**
 * Loads only the known legacy yoga nbind entry and replaces its four dynamic-code fallbacks.
 * Package resolution and every other dependency remain owned by esbuild's native loader.
 */
export function createPreviewLegacyNbindCspPlugin(
  options: PreviewLegacyNbindCspPluginOptions,
): Plugin {
  return {
    name: 'react-preview-legacy-nbind-csp',
    setup(build): void {
      build.onLoad({ filter: NBIND_FILE_FILTER, namespace: 'file' }, async (arguments_) => {
        if (!isLegacyNbindPackagePath(arguments_.path)) return undefined;
        const sourceText = await options.readSource({
          maximumBytes: MAXIMUM_NBIND_SOURCE_BYTES,
          sourcePath: arguments_.path,
        });
        if (sourceText === undefined) return undefined;
        const contents = preparePreviewLegacyNbindCspSource(arguments_.path, sourceText);
        if (contents === undefined) return undefined;
        return {
          contents,
          loader: 'js',
          resolveDir: path.dirname(arguments_.path),
        } satisfies OnLoadResult;
      });
    },
  };
}

/**
 * Replaces only an exact, parser-proven nbind implementation shape. Unknown package revisions pass
 * through unchanged instead of receiving a speculative source edit or a weakened CSP policy.
 */
export function preparePreviewLegacyNbindCspSource(
  sourcePath: string,
  sourceText: string,
): string | undefined {
  if (
    !isLegacyNbindPackagePath(sourcePath) ||
    !sourceText.includes('eval(') ||
    sourceText.includes(GENERATED_PREFIX) ||
    !sourceText.includes('_nbind.resources = { pool: new Resource(') ||
    !sourceText.includes('_nbind.buildJSCallerFunction = buildJSCallerFunction') ||
    !sourceText.includes('_nbind.makeMethodCaller = makeMethodCaller')
  ) {
    return undefined;
  }
  const syntax = collectLegacyNbindSyntax(sourcePath, sourceText);
  if (syntax === undefined || !hasExpectedLegacyNbindBodies(syntax, sourceText)) return undefined;
  return applyPreviewSourceReplacements(sourceText, [
    replacementForNode(syntax.getCFunc, syntax.sourceFile, SAFE_GET_C_FUNC_SOURCE),
    replacementForNode(syntax.cwrap, syntax.sourceFile, SAFE_CWRAP_SOURCE),
    replacementForNode(syntax.buildCaller, syntax.sourceFile, SAFE_BUILD_CALLER_SOURCE),
    replacementForNode(syntax.buildJsCaller, syntax.sourceFile, SAFE_BUILD_JS_CALLER_SOURCE),
  ]);
}

/** Accepts an ordinary node_modules path or the same entry nested inside a Yarn cache archive. */
function isLegacyNbindPackagePath(sourcePath: string): boolean {
  return path.normalize(sourcePath).endsWith(NBIND_PACKAGE_SUFFIX);
}

/** Collects each unique named declaration without relying on generated-file whitespace. */
function collectLegacyNbindSyntax(
  sourcePath: string,
  sourceText: string,
): LegacyNbindSyntax | undefined {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if ((parseDiagnostics?.length ?? 0) > 0) return undefined;
  const buildCallers: ts.FunctionDeclaration[] = [];
  const buildJsCallers: ts.FunctionDeclaration[] = [];
  const cwraps: ts.FunctionExpression[] = [];
  const getCFuncs: ts.FunctionDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node)) {
      if (node.name?.text === 'buildCallerFunction') {
        buildCallers.push(node);
      } else if (node.name?.text === 'buildJSCallerFunction') {
        buildJsCallers.push(node);
      } else if (node.name?.text === 'getCFunc') {
        getCFuncs.push(node);
      }
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      node.left.text === 'cwrap' &&
      ts.isFunctionExpression(node.right) &&
      node.right.name?.text === 'cwrap'
    ) {
      cwraps.push(node.right);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const [buildCaller] = buildCallers;
  const [buildJsCaller] = buildJsCallers;
  const [cwrap] = cwraps;
  const [getCFunc] = getCFuncs;
  return buildCallers.length !== 1 ||
    buildJsCallers.length !== 1 ||
    cwraps.length !== 1 ||
    getCFuncs.length !== 1 ||
    buildCaller === undefined ||
    buildJsCaller === undefined ||
    cwrap === undefined ||
    getCFunc === undefined
    ? undefined
    : {
        buildCaller,
        buildJsCaller,
        cwrap,
        getCFunc,
        sourceFile,
      };
}

/** Locks the adapter to the legacy signatures and dynamic expressions it actually implements. */
function hasExpectedLegacyNbindBodies(syntax: LegacyNbindSyntax, sourceText: string): boolean {
  return (
    hasParameters(syntax.getCFunc, ['ident']) &&
    hasParameters(syntax.cwrap, ['ident', 'returnType', 'argTypes']) &&
    hasParameters(syntax.buildCaller, [
      'dynCall',
      'ptrType',
      'ptr',
      'num',
      'policyTbl',
      'needsWireWrite',
      'prefix',
      'returnType',
      'argTypeList',
      'mask',
      'err',
    ]) &&
    hasParameters(syntax.buildJsCaller, ['returnType', 'argTypeList']) &&
    nodeText(syntax.getCFunc, syntax.sourceFile, sourceText).includes('eval("_" + ident)') &&
    nodeText(syntax.cwrap, syntax.sourceFile, sourceText).includes('return eval(funcstr)') &&
    nodeText(syntax.buildCaller, syntax.sourceFile, sourceText).includes(
      'return eval("(" + sourceCode + ")")',
    ) &&
    nodeText(syntax.buildJsCaller, syntax.sourceFile, sourceText).includes(
      'return eval("(" + sourceCode + ")")',
    )
  );
}

/** Requires simple identifier parameters in their original order. */
function hasParameters(
  node: ts.FunctionDeclaration | ts.FunctionExpression,
  expected: readonly string[],
): boolean {
  return (
    node.parameters.length === expected.length &&
    node.parameters.every(
      (parameter, index) =>
        ts.isIdentifier(parameter.name) && parameter.name.text === expected[index],
    )
  );
}

/** Reads one parser-owned range from the unmodified dependency source. */
function nodeText(node: ts.Node, sourceFile: ts.SourceFile, sourceText: string): string {
  return sourceText.slice(node.getStart(sourceFile), node.end);
}

/** Produces one validated source edit for the shared replacement utility. */
function replacementForNode(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  replacement: string,
): { readonly end: number; readonly replacement: string; readonly start: number } {
  return { end: node.end, replacement, start: node.getStart(sourceFile) };
}

const SAFE_GET_C_FUNC_SOURCE = `function getCFunc(ident) {
  var func = Module["_" + ident];
  if (!func && typeof globalThis !== "undefined") func = globalThis["_" + ident];
  assert(func, "Cannot call unknown function " + ident + " (perhaps LLVM optimizations or closure removed it?)");
  return func;
}`;

const SAFE_CWRAP_SOURCE = `function cwrap(ident, returnType, argTypes) {
  argTypes = argTypes || [];
  return function () {
    return ccall(ident, returnType, argTypes, Array.prototype.slice.call(arguments));
  };
}`;

const SAFE_BUILD_CALLER_SOURCE = `function ${GENERATED_PREFIX}CreateWireRead(type, policyTbl) {
  var convertParamList = [];
  var marker = "${GENERATED_PREFIX}WireValue";
  var expression = makeWireRead(convertParamList, policyTbl, type, marker);
  if (expression === marker) return function (value) { return value; };
  if (expression === "!!(" + marker + ")") return function (value) { return !!value; };
  if (expression === "(convertParamList[0](" + marker + "))" && convertParamList.length === 1) {
    return convertParamList[0];
  }
  throw new Error("React Preview could not statically adapt an nbind wire-read converter.");
}
function ${GENERATED_PREFIX}CreateWireWrite(type, policyTbl) {
  var convertParamList = [];
  var marker = "${GENERATED_PREFIX}WireValue";
  var expression = makeWireWrite(convertParamList, policyTbl, type, marker);
  if (expression === marker) return function (value) { return value; };
  if (expression === "!!(" + marker + ")") return function (value) { return !!value; };
  if (expression === "(convertParamList[0](" + marker + "))" && convertParamList.length === 1) {
    return convertParamList[0];
  }
  if (expression === "(_nbind.pushValue(new " + marker + "))") {
    return function (value) { return _nbind.pushValue(new value()); };
  }
  throw new Error("React Preview could not statically adapt an nbind wire-write converter.");
}
function ${GENERATED_PREFIX}UsesPool(readTypes, writeTypes) {
  var pool = _nbind.resources.pool;
  return readTypes.some(function (type) {
    return (type.readResources || []).indexOf(pool) >= 0;
  }) || writeTypes.some(function (type) {
    return (type.writeResources || []).indexOf(pool) >= 0;
  });
}
function buildCallerFunction(dynCall, ptrType, ptr, num, policyTbl, needsWireWrite, prefix, returnType, argTypeList, mask, err) {
  var argConverters = argTypeList.map(function (type) {
    return ${GENERATED_PREFIX}CreateWireWrite(type, policyTbl);
  });
  var returnConverter = ${GENERATED_PREFIX}CreateWireRead(returnType, policyTbl);
  var usesPool = ${GENERATED_PREFIX}UsesPool([returnType], argTypeList);
  return function () {
    if (mask && this.__nbindFlags & mask) err();
    var prefixArgs;
    if (prefix === "ptr,num,pushPointer(this,ptrType)") {
      prefixArgs = [ptr, num, pushPointer(this, ptrType)];
    } else if (prefix === "ptr,num") {
      prefixArgs = [ptr, num];
    } else if (prefix === "ptr") {
      prefixArgs = [ptr];
    } else {
      throw new Error("React Preview rejected an unknown nbind caller prefix.");
    }
    var args = new Array(argConverters.length);
    for (var index = 0; index < args.length; ++index) args[index] = argConverters[index](arguments[index]);
    var used;
    var page;
    if (usesPool) {
      used = HEAPU32[_nbind.Pool.usedPtr];
      page = HEAPU32[_nbind.Pool.pagePtr];
    }
    var result = returnConverter(dynCall.apply(null, prefixArgs.concat(args)));
    if (usesPool) _nbind.Pool.lreset(used, page);
    return result;
  };
}`;

const SAFE_BUILD_JS_CALLER_SOURCE = `function buildJSCallerFunction(returnType, argTypeList) {
  var argConverters = argTypeList.map(function (type) {
    return ${GENERATED_PREFIX}CreateWireRead(type, null);
  });
  var returnConverter = ${GENERATED_PREFIX}CreateWireWrite(returnType, null);
  return function (dummy, num) {
    var args = new Array(argConverters.length);
    for (var index = 0; index < args.length; ++index) args[index] = argConverters[index](arguments[index + 2]);
    var external = _nbind.externalList[num];
    return returnConverter(external.data.apply(external, args));
  };
}`;

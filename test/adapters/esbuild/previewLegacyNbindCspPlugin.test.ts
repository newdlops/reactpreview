/** Verifies CSP-safe adaptation of the reached yoga-layout-prebuilt nbind runtime. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { preparePreviewLegacyNbindCspSource } from '../../../src/adapters/esbuild/previewLegacyNbindCspPlugin';

const NBIND_PATH = path.join(
  '/workspace',
  '.yarn',
  'cache',
  'yoga-layout-prebuilt-npm-1.10.0.zip',
  'node_modules',
  'yoga-layout-prebuilt',
  'yoga-layout',
  'build',
  'Release',
  'nbind.js',
);

describe('preparePreviewLegacyNbindCspSource', () => {
  /** Removes every dynamic-code fallback while retaining direct caller and cwrap semantics. */
  it('replaces the exact legacy nbind generators without enabling unsafe-eval', () => {
    const transformed = preparePreviewLegacyNbindCspSource(NBIND_PATH, createLegacyNbindSource());

    expect(transformed).toBeDefined();
    expect(transformed).not.toContain('eval(');
    expect(transformed).toContain('__reactPreviewNbindCreateWireRead');
    expect(transformed).toContain('return ccall(ident, returnType, argTypes');
    expect(transformed).toContain('dynCall.apply(null, prefixArgs.concat(args))');
    expect(transformed).toContain('external.data.apply(external, args)');
    expect(transformed).toContain('var args = new Array(argConverters.length)');
  });

  /** Refuses lookalike modules and changed generator contracts instead of patching speculatively. */
  it('fails closed outside the exact package and source shape', () => {
    const source = createLegacyNbindSource();

    expect(
      preparePreviewLegacyNbindCspSource('/workspace/node_modules/lookalike/nbind.js', source),
    ).toBeUndefined();
    expect(
      preparePreviewLegacyNbindCspSource(
        NBIND_PATH,
        source.replace('return eval(funcstr);', 'return sourceCode;'),
      ),
    ).toBeUndefined();
  });
});

/** Minimal parser-valid copy of the four legacy dynamic generation boundaries. */
function createLegacyNbindSource(): string {
  return `var Module = {};
var _nbind = {};
function assert(value, message) { if (!value) throw new Error(message); }
function Resource(open, close) { this.open = open; this.close = close; }
_nbind.resources = { pool: new Resource("open", "close") };
function getCFunc(ident) {
  var func = Module["_" + ident];
  if (!func) { try { func = eval("_" + ident); } catch (error) {} }
  assert(func, "missing");
  return func;
}
var ccall = function () {};
var cwrap;
cwrap = function cwrap(ident, returnType, argTypes) {
  var funcstr = ident + returnType + argTypes;
  return eval(funcstr);
};
function makeWireRead(convertParamList, policyTbl, type, expression) { return expression; }
function makeWireWrite(convertParamList, policyTbl, type, expression) { return expression; }
function pushPointer(value) { return value; }
function buildCallerFunction(dynCall, ptrType, ptr, num, policyTbl, needsWireWrite, prefix, returnType, argTypeList, mask, err) {
  var sourceCode = prefix;
  return eval("(" + sourceCode + ")");
}
function buildJSCallerFunction(returnType, argTypeList) {
  var sourceCode = returnType + argTypeList;
  return eval("(" + sourceCode + ")");
}
_nbind.buildJSCallerFunction = buildJSCallerFunction;
function makeMethodCaller() { return buildCallerFunction; }
_nbind.makeMethodCaller = makeMethodCaller;
module.exports = _nbind;
`;
}

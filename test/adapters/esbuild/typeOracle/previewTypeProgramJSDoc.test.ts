/** Type-only parsing must preserve JavaScript declarations and isolate parser cache settings. */
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { readPreviewAnalysisSourceFile } from '../../../../src/adapters/esbuild/previewAnalysisSourceFile';
import {
  createPreviewTypeProgram,
  PreviewTypeSourceFileCache,
  type PreviewTypeProgram,
} from '../../../../src/adapters/esbuild/typeOracle/previewTypeProgram';
import { readPreviewTypedComponentProps } from '../../../../src/adapters/esbuild/typeOracle/previewTypedComponentProps';

const ROOT = path.resolve('/virtual/react-preview-type-docs');
const TS_PATH = path.join(ROOT, 'page.ts');
const JS_PATH = path.join(ROOT, 'payload.js');
const TS_TEXT = `
/** Human-readable documentation that has no declared type effect. */
export interface Props {
  /** A descriptive title. */
  status: 'ready';
  /** @deprecated Prefer the newer field. */
  count: 3;
}
/** Documentation about the component. */
export function Page(props: Props) { return null; }
`;
const JS_TEXT = `
/** @typedef {{status: 'ready', count: 3}} Payload */
/**
 * @param {Payload} value The declared payload.
 * @returns {Payload}
 */
export function usePayload(value) { return value; }
`;

describe('private type-program JSDoc parsing', () => {
  it('skips descriptive TypeScript JSDoc while preserving declared props and ordinary nodes', () => {
    const analysis = analyze(TS_PATH, TS_TEXT);
    const source = readSource(analysis, TS_PATH);
    const original = ts.createSourceFile(TS_PATH, TS_TEXT, ts.ScriptTarget.ES2022, true);
    expect(countDocumentation(original)).toBeGreaterThan(0);
    expect(countDocumentation(source)).toBe(0);
    expect(countNodes(source)).toBe(countNodes(original));
    expect(readPreviewTypedComponentProps(analysis.checker, source, 'Page')).toEqual({
      count: 3,
      status: 'ready',
    });
    expect(source.text).toBe(TS_TEXT);
    expect(analysis.status.projectFiles).toBe(1);
    expect(analysis.status.refusedModules).toBe(0);
  });

  it('keeps JavaScript typedef, parameter and return types available to the real checker', () => {
    const analysis = analyze(JS_PATH, JS_TEXT);
    const source = readSource(analysis, JS_PATH);
    expect(countDocumentation(source)).toBeGreaterThan(0);
    expect(readReturnProperty(analysis, source, 'status')).toBe('"ready"');
    expect(readReturnProperty(analysis, source, 'count')).toBe('3');
    expect(source.text).toBe(JS_TEXT);
    expect(analysis.status).toMatchObject({ projectFiles: 1, refusedModules: 0 });
  });

  it('preserves TypeScript link syntax needed for accurate type diagnostics', () => {
    const text = '/** See {@link Payload}. */ export interface Payload { status: "ready"; }';
    const source = readSource(analyze(TS_PATH, text), TS_PATH);
    expect(countDocumentation(source)).toBe(1);
    expect(source.text).toBe(text);
  });

  it('separates the same path/text/target when JSDoc mode changes, and reuses exact settings', () => {
    const cache = new PreviewTypeSourceFileCache();
    const settings = { languageVersion: ts.ScriptTarget.ES2022 };
    const full = cache.get(TS_PATH, TS_TEXT, {
      ...settings,
      jsDocParsingMode: ts.JSDocParsingMode.ParseAll,
    });
    const typeSettings = {
      ...settings,
      jsDocParsingMode: ts.JSDocParsingMode.ParseForTypeErrors,
    };
    const typed = cache.get(TS_PATH, TS_TEXT, typeSettings);
    expect(typed).not.toBe(full);
    expect(countDocumentation(typed)).toBe(0);
    expect(countDocumentation(full)).toBeGreaterThan(0);
    expect(cache.get(TS_PATH, TS_TEXT, { ...typeSettings })).toBe(typed);
    expect(
      cache.get(TS_PATH, TS_TEXT, {
        ...settings,
        jsDocParsingMode: ts.JSDocParsingMode.ParseAll,
      }),
    ).not.toBe(typed);
  });

  it('refreshes dirty JavaScript JSDoc without mutating a prior program', () => {
    const cache = new PreviewTypeSourceFileCache();
    const first = analyze(JS_PATH, JS_TEXT, cache);
    const edited = JS_TEXT.replace("status: 'ready'", "status: 'changed'");
    const second = analyze(JS_PATH, edited, cache);
    expect(readReturnProperty(first, readSource(first, JS_PATH), 'status')).toBe('"ready"');
    expect(readReturnProperty(second, readSource(second, JS_PATH), 'status')).toBe('"changed"');
    expect(second.status.admittedBytes - first.status.admittedBytes).toBe(
      edited.length - JS_TEXT.length,
    );
  });

  it('leaves the runtime and read-only syntax parsers on their original full-documentation mode', () => {
    const original = readPreviewAnalysisSourceFile(TS_PATH, TS_TEXT, ts.ScriptKind.TS);
    expect(countDocumentation(original)).toBeGreaterThan(0);
    analyze(TS_PATH, TS_TEXT);
    expect(countDocumentation(original)).toBeGreaterThan(0);
    expect(readPreviewAnalysisSourceFile(TS_PATH, TS_TEXT, ts.ScriptKind.TS)).toBe(original);
  });
});

/** Serves one exact unsaved module to the actual budgeted program without creating a project. */
function analyze(
  sourcePath: string,
  text: string,
  cache = new PreviewTypeSourceFileCache(),
): PreviewTypeProgram {
  return createPreviewTypeProgram(
    {
      managedNodeModulesPaths: [],
      readSnapshot: (file) => (file === sourcePath ? text : undefined),
      rootPaths: [sourcePath],
    },
    cache,
  );
}

/** Reads the real admitted AST or fails clearly instead of testing an absent module. */
function readSource(analysis: PreviewTypeProgram, sourcePath: string): ts.SourceFile {
  const source = analysis.program.getSourceFile(sourcePath);
  if (source === undefined) throw new Error(`Fixture module not admitted: ${sourcePath}`);
  return source;
}

/** Counts attached JSDoc separately because TypeScript's normal child traversal excludes it. */
function countDocumentation(root: ts.Node): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    count += ts.getJSDocCommentsAndTags(node).length;
    ts.forEachChild(node, visit);
  };
  visit(root);
  return count;
}

/** Preserves the ordinary syntax traversal charged by type synthesis. */
function countNodes(root: ts.Node): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    count += 1;
    ts.forEachChild(node, visit);
  };
  visit(root);
  return count;
}

/** Uses a real function signature and property symbol, including JSDoc-derived return types. */
function readReturnProperty(
  analysis: PreviewTypeProgram,
  source: ts.SourceFile,
  name: string,
): string {
  const declaration = source.statements.find(ts.isFunctionDeclaration);
  if (declaration === undefined) throw new Error('Fixture function missing');
  const signature = analysis.checker.getSignatureFromDeclaration(declaration);
  if (signature === undefined) throw new Error('Fixture signature missing');
  const result = analysis.checker.getReturnTypeOfSignature(signature);
  const property = analysis.checker.getPropertyOfType(result, name);
  if (property === undefined) throw new Error(`Fixture return field missing: ${name}`);
  return analysis.checker.typeToString(
    analysis.checker.getTypeOfSymbolAtLocation(property, declaration),
  );
}

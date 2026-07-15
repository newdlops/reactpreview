/**
 * Verifies deterministic target-export selection independently from esbuild module resolution.
 * Inline source represents the current editor snapshot, including exports not yet saved to disk.
 */
import { describe, expect, it } from 'vitest';
import { selectPreviewTargetExport } from '../../../src/adapters/esbuild/previewTargetExports';
import { PreviewCompilationError } from '../../../src/domain/preview';

describe('selectPreviewTargetExport', () => {
  /** Keeps an explicit runtime default ahead of filename and single-component heuristics. */
  it('prefers a runtime default export', () => {
    const selection = selectPreviewTargetExport(
      '/workspace/src/CompanyOwnerBreadcrumb.tsx',
      [
        'export const CompanyOwnerBreadcrumb = () => <nav />;',
        'export default function DifferentPreview() { return <main />; }',
      ].join('\n'),
    );

    expect(selection).toEqual({ exportName: 'default' });
  });

  /** Recognizes a local runtime binding explicitly aliased to the module's default export. */
  it('recognizes a runtime default export clause', () => {
    const selection = selectPreviewTargetExport(
      '/workspace/src/Preview.tsx',
      [
        'const Preview = () => <main />;',
        'interface Properties { readonly title: string }',
        'export { Preview as default };',
      ].join('\n'),
    );

    expect(selection).toEqual({ exportName: 'default' });
  });

  /** Treats an external default re-export as runtime without resolving or executing that module. */
  it('recognizes an external default re-export', () => {
    const selection = selectPreviewTargetExport(
      '/workspace/src/Preview.tsx',
      "export { default } from './ActualPreview';",
    );

    expect(selection).toEqual({ exportName: 'default' });
  });

  /** Uses a kebab-case filename match when several PascalCase components are exported. */
  it('selects the PascalCase filename match before the unique-candidate rule', () => {
    const selection = selectPreviewTargetExport(
      '/workspace/src/company-owner-breadcrumb.tsx',
      [
        'export const OtherBreadcrumb = () => <nav />;',
        'export function CompanyOwnerBreadcrumb() { return <nav />; }',
      ].join('\n'),
    );

    expect(selection).toEqual({ exportName: 'CompanyOwnerBreadcrumb' });
  });

  /** Supports snake-case filenames while preserving an already camel-cased identifier suffix. */
  it('normalizes common filename separators for exact matching', () => {
    const selection = selectPreviewTargetExport(
      '/workspace/src/company_ownerBreadcrumb.jsx',
      [
        'export const Alternative = () => <aside />;',
        'export const CompanyOwnerBreadcrumb = () => <nav />;',
      ].join('\n'),
    );

    expect(selection).toEqual({ exportName: 'CompanyOwnerBreadcrumb' });
  });

  /** Selects one PascalCase runtime value while excluding erased and ambient declarations. */
  it('ignores type-only and declared exports when selecting a unique named component', () => {
    const selection = selectPreviewTargetExport(
      '/workspace/src/unrelated-name.tsx',
      [
        'export interface InterfacePreview { readonly value: string }',
        'export type AliasPreview = { readonly value: string };',
        'export declare class AmbientPreview {}',
        'export const helper = 1;',
        'export const OnlyRuntimePreview = () => <main />;',
      ].join('\n'),
    );

    expect(selection).toEqual({ exportName: 'OnlyRuntimePreview' });
  });

  /** Resolves aliases only when their local binding exists at runtime. */
  it('distinguishes runtime and type-only local export clauses', () => {
    const selection = selectPreviewTargetExport(
      '/workspace/src/unrelated.tsx',
      [
        'const Internal = () => <main />;',
        'type InternalProperties = { readonly value: string };',
        'export { Internal as AliasedPreview };',
        'export { type InternalProperties as TypePreview };',
      ].join('\n'),
    );

    expect(selection).toEqual({ exportName: 'AliasedPreview' });
  });

  /** Does not mistake an erased default interface for the module's runtime default. */
  it('ignores an erased default declaration', () => {
    const selection = selectPreviewTargetExport(
      '/workspace/src/unrelated.tsx',
      [
        'export default interface PreviewProperties { readonly value: string }',
        'export const RuntimePreview = () => <main />;',
      ].join('\n'),
    );

    expect(selection).toEqual({ exportName: 'RuntimePreview' });
  });

  /** Reports every ambiguous component and points at the first real export in the selected file. */
  it('throws a located domain diagnostic for ambiguous PascalCase exports', () => {
    const documentPath = '/workspace/src/unrelated.tsx';
    let failure: unknown;

    try {
      selectPreviewTargetExport(
        documentPath,
        [
          '// current dirty editor source',
          'export const FirstPreview = () => <main />;',
          'export const SecondPreview = () => <aside />;',
        ].join('\n'),
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(PreviewCompilationError);
    if (!(failure instanceof PreviewCompilationError)) {
      return;
    }
    expect(failure.message).toContain('unrelated.tsx');
    expect(failure.diagnostics).toHaveLength(1);
    expect(failure.diagnostics[0]?.location).toMatchObject({ file: documentPath, line: 2 });
    expect(failure.diagnostics[0]?.message).toContain('FirstPreview');
    expect(failure.diagnostics[0]?.message).toContain('SecondPreview');
  });

  /** Lists non-component runtime names when no PascalCase export can be selected. */
  it('throws an actionable diagnostic when no component candidate exists', () => {
    const documentPath = '/workspace/src/helpers.ts';

    expect.assertions(4);
    try {
      selectPreviewTargetExport(
        documentPath,
        [
          'export interface HelperProperties { readonly value: string }',
          'export const helper = () => null;',
        ].join('\n'),
      );
    } catch (error) {
      expect(error).toBeInstanceOf(PreviewCompilationError);
      if (!(error instanceof PreviewCompilationError)) {
        return;
      }
      expect(error.diagnostics[0]?.location).toMatchObject({ file: documentPath, line: 2 });
      expect(error.diagnostics[0]?.message).toContain('Named runtime exports: helper');
      expect(error.diagnostics[0]?.message).toContain('Export the preview component as default');
    }
  });

  /** Uses parser-owned dirty-source coordinates instead of falling through to bridge diagnostics. */
  it('reports invalid current editor syntax at its actual source location', () => {
    const documentPath = '/workspace/src/Preview.tsx';

    expect.assertions(3);
    try {
      selectPreviewTargetExport(
        documentPath,
        ['export const valid = 1;', 'export function Broken( {'].join('\n'),
      );
    } catch (error) {
      expect(error).toBeInstanceOf(PreviewCompilationError);
      if (!(error instanceof PreviewCompilationError)) {
        return;
      }
      expect(error.diagnostics[0]?.location).toMatchObject({ file: documentPath, line: 2 });
      expect(error.diagnostics[0]?.message.length).toBeGreaterThan(0);
    }
  });

  /** Parses JSX in ordinary `.js` snapshots because the compiler intentionally uses its JSX loader. */
  it('supports JSX syntax in JavaScript source variants', () => {
    const selection = selectPreviewTargetExport(
      '/workspace/src/preview.cjs',
      'export const JavaScriptPreview = () => <main />;',
    );

    expect(selection).toEqual({ exportName: 'JavaScriptPreview' });
  });

  /** Preserves the default interop bridge for conventional CommonJS component assignments. */
  it('recognizes a CommonJS module.exports component', () => {
    const selection = selectPreviewTargetExport(
      '/workspace/src/common-preview.cjs',
      'module.exports = function CommonPreview() { return <main />; };',
    );

    expect(selection).toEqual({ exportName: 'default' });
  });

  /** Treats TypeScript export-equals syntax as the module's runtime default interop value. */
  it('recognizes a TypeScript export-equals component', () => {
    const selection = selectPreviewTargetExport(
      '/workspace/src/CommonPreview.cts',
      'function CommonPreview() { return null; } export = CommonPreview;',
    );

    expect(selection).toEqual({ exportName: 'default' });
  });
});

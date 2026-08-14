import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { createPreviewAgGridModuleRegistration } from '../../../../src/adapters/esbuild/staticResources/previewAgGridModuleRegistration';

describe('preview AG Grid module registration', () => {
  it('registers the reached enterprise module before an isolated grid source renders', () => {
    const sourcePath = '/workspace/Grid.tsx';
    const sourceFile = ts.createSourceFile(
      sourcePath,
      'import { AgGridReact } from "ag-grid-react"; export const Grid = () => <AgGridReact />;',
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    let index = 0;

    const statements = createPreviewAgGridModuleRegistration(
      sourceFile,
      'enterprise',
      (kind) => `__preview_${kind}_${(index += 1).toString()}`,
    );

    expect(statements.join('\n')).toContain('from "ag-grid-enterprise"');
    expect(statements.join('\n')).toContain(
      "Reflect.get(__preview_agGridModules_1, 'ModuleRegistry')",
    );
    expect(statements.join('\n')).toContain('"AllEnterpriseModule"');
    expect(statements.join('\n')).toContain('registerModules([__preview_agGridAllModule_3])');
  });

  it('does not bootstrap for erased type imports or an unavailable module package', () => {
    const sourcePath = '/workspace/Grid.tsx';
    const typeOnly = ts.createSourceFile(
      sourcePath,
      'import type { AgGridReactProps } from "ag-grid-react";',
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const runtime = ts.createSourceFile(
      sourcePath,
      'import { AgGridReact } from "ag-grid-react";',
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

    expect(createPreviewAgGridModuleRegistration(typeOnly, 'enterprise', () => '__unused')).toEqual(
      [],
    );
    expect(createPreviewAgGridModuleRegistration(runtime, undefined, () => '__unused')).toEqual([]);
  });
});

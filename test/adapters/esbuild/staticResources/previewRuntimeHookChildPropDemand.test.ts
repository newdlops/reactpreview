/** Verifies bounded child-prop demand propagation without importing or executing project modules. */
import { describe, expect, it } from 'vitest';
import { PreviewRuntimeHookChildPropDemandCatalogBuilder } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookChildPropDemand';
import { createPreviewRuntimeHookReplacements } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInstrumentation';

describe('PreviewRuntimeHookChildPropDemandCatalogBuilder', () => {
  /** Carries an operation-proven child Array back through a hook-fed JSX carrier property. */
  it('completes a nested query response used by an imported child component', () => {
    const parentPath = '/workspace/HistoryPage.tsx';
    const childPath = '/workspace/HistoryTable.tsx';
    const parentSource = [
      `import { useQuery } from '@tanstack/react-query';`,
      `import { HistoryTable } from './HistoryTable';`,
      'export function HistoryPage() {',
      '  const { data } = useQuery({ queryKey: ["rides"] });',
      '  return data && <HistoryTable data={data.data} />;',
      '}',
    ].join('\n');
    const childSource = [
      'interface HistoryTableProps { data: ImportedResponse }',
      'export function HistoryTable(props: HistoryTableProps) {',
      '  const { data } = props;',
      '  return <main>{data.rides.map((ride) => <span key={ride.id}>{ride.name}</span>)}</main>;',
      '}',
    ].join('\n');
    const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
      readSource: (sourcePath) => (sourcePath === childPath ? childSource : undefined),
      resolveModule: (moduleSpecifier) =>
        moduleSpecifier === './HistoryTable' ? childPath : undefined,
      workspaceRoot: '/workspace',
    });
    const replacements = createPreviewRuntimeHookReplacements(
      parentPath,
      parentSource,
      builder.collect(parentPath, parentSource),
    );
    const transformed = applyReplacements(parentSource, replacements);

    expect(transformed).toContain(
      '"data": Object.freeze({ "data": Object.freeze({ "rides": Object.freeze([]) }) })',
    );
    expect(transformed).toContain('"requiredPaths":["data.data","data.data.rides.map()"]');
  });

  /** Leaves authored optional carrier chains untouched because they intentionally short-circuit. */
  it('does not turn an optional JSX carrier into a hard hook requirement', () => {
    const parentPath = '/workspace/HistoryPage.tsx';
    const childPath = '/workspace/HistoryTable.tsx';
    const parentSource = [
      `import { useQuery } from './use-query';`,
      `import { HistoryTable } from './HistoryTable';`,
      'export function HistoryPage() {',
      '  const query = useQuery();',
      '  return <HistoryTable data={query.data?.data} />;',
      '}',
    ].join('\n');
    const childSource = [
      'export function HistoryTable({ data }: { data: unknown }) {',
      '  return <main>{data.rides.map((ride) => ride.id)}</main>;',
      '}',
    ].join('\n');
    const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
      readSource: () => childSource,
      resolveModule: () => childPath,
      workspaceRoot: '/workspace',
    });
    const transformed = applyReplacements(
      parentSource,
      createPreviewRuntimeHookReplacements(
        parentPath,
        parentSource,
        builder.collect(parentPath, parentSource),
      ),
    );

    expect(transformed).not.toContain('data.data.rides.map()');
  });
});

/** Applies source-ordered zero-width/range replacements like the shared transformer. */
function applyReplacements(
  source: string,
  replacements: readonly {
    readonly end: number;
    readonly replacement: string;
    readonly start: number;
  }[],
): string {
  let transformed = source;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    transformed =
      transformed.slice(0, replacement.start) +
      replacement.replacement +
      transformed.slice(replacement.end);
  }
  return transformed;
}

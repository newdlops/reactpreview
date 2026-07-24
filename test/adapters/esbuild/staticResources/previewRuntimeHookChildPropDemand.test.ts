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

  /**
   * Resolves an imported nested collection type and carries it through a filtering JSX carrier.
   *
   * This models an application shell whose navigation hook is generated in the parent while the
   * reached child is the first module that proves which page fields are required to render.
   */
  it('propagates transitive imported item fields through identity-preserving collection transforms', () => {
    const parentPath = '/workspace/Navigation.tsx';
    const childPath = '/workspace/NavigationCategories.tsx';
    const typesPath = '/workspace/navigation-types.ts';
    const parentSource = [
      `import { useNavigationData } from './use-navigation-data';`,
      `import { NavigationCategories } from './NavigationCategories';`,
      'export function Navigation() {',
      '  const categories = useNavigationData();',
      '  return <NavigationCategories categories={categories.filter(Boolean)} />;',
      '}',
    ].join('\n');
    const childSource = [
      `import type { Category } from './navigation-types';`,
      'type Props = { categories: readonly Category[] };',
      'export const NavigationCategories = ({ categories }: Props) => (',
      '  <nav>{categories.map((category) => <span key={category.name}>{category.name}</span>)}</nav>',
      ');',
    ].join('\n');
    const typesSource = [
      'export type Page = { label: string; pageNameOrUrl: string; activeRoutes?: readonly (RegExp | string)[] };',
      'export type PageGroup = { label?: string; pages: readonly Page[] };',
      'export type Category = { name: string; icon: string; pageGroups: readonly PageGroup[] };',
    ].join('\n');
    const sources = new Map([
      [childPath, childSource],
      [typesPath, typesSource],
    ]);
    const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
      readSource: (sourcePath) => sources.get(sourcePath),
      resolveModule: (moduleSpecifier, consumerPath) => {
        if (consumerPath === parentPath && moduleSpecifier === './NavigationCategories')
          return childPath;
        if (consumerPath === childPath && moduleSpecifier === './navigation-types')
          return typesPath;
        return undefined;
      },
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

    expect(transformed).toContain('"pageNameOrUrl": "pageNameOrUrl"');
    expect(transformed).toContain('"pageGroups": Object.freeze([');
    expect(transformed).toContain('"pages": Object.freeze([');
    expect(transformed).toContain('[].pageGroups[].pages[].pageNameOrUrl');
  });

  /**
   * Expands an imported array item annotation when the selected query value first reaches a pure
   * helper rather than a JSX child.
   */
  it('propagates an imported typed collection contract into a hook fallback', () => {
    const parentPath = '/workspace/Panel.tsx';
    const typesPath = '/workspace/types.ts';
    const parentSource = [
      `import { useQuery } from './use-query';`,
      `import { buildRows } from './build-rows';`,
      `import type { Item } from './types';`,
      'export function Panel() {',
      '  const { data } = useQuery();',
      '  const items = (data?.items ?? []) as Item[];',
      '  const rows = buildRows(items);',
      '  return <main>{rows.length}</main>;',
      '}',
    ].join('\n');
    const typesSource = [
      'export type Child = { id: string; label: string };',
      'export type Item = { id: string; name: string; children: Child[] };',
    ].join('\n');
    const sources = new Map([
      [parentPath, parentSource],
      [typesPath, typesSource],
    ]);
    const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
      readSource: (sourcePath) => sources.get(sourcePath),
      resolveModule: (moduleSpecifier, consumerPath) =>
        consumerPath === parentPath && moduleSpecifier === './types' ? typesPath : undefined,
      workspaceRoot: '/workspace',
    });
    const transformed = applyReplacements(
      parentSource,
      createPreviewRuntimeHookReplacements(
        parentPath,
        parentSource,
        builder.collect(parentPath, parentSource),
        (typeNode) => builder.inferLocalTypeFallback(parentPath, parentSource, typeNode),
      ),
    );

    expect(transformed).toContain(
      '"items": Object.freeze([Object.freeze({ "children": Object.freeze([',
    );
    expect(transformed).toContain('"id": "id"');
    expect(transformed).toContain('"label": "label"');
    expect(transformed).toContain('"failurePaths":["data.items[]"');
    expect(transformed).toContain('data.items[].children[].label');
  });

  /**
   * Propagates a reached child's dormant overlay contract into its parent hook fallback.
   *
   * Without these scalar leaves the generated object contains `undefined`; inequality checks such
   * as `undefined !== null` then open every sibling modal and obscure the actual page.
   */
  it('keeps non-target child overlays dormant with null and false scalar values', () => {
    const parentPath = '/workspace/ManagementPanel.tsx';
    const childPath = '/workspace/ManagementModals.tsx';
    const parentSource = [
      `import { useAgreementModals } from './useAgreementModals';`,
      `import { ManagementModals } from './ManagementModals';`,
      'export function ManagementPanel() {',
      '  const modals = useAgreementModals();',
      '  const open = modals.requestUpload;',
      '  return <ManagementModals modals={modals} />;',
      '}',
    ].join('\n');
    const childSource = [
      'export function ManagementModals({ modals }: { modals: unknown }) {',
      '  return <>',
      '    <UploadModal show={modals.uploadTarget !== null} />',
      '    <BulkModal show={modals.bulkUploadOpen} />',
      '    <EditModal show={modals.editTarget !== null} />',
      '    <DeleteModal show={modals.deleteTarget !== null} />',
      '  </>;',
      '}',
    ].join('\n');
    const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
      readSource: (sourcePath) => (sourcePath === childPath ? childSource : undefined),
      resolveModule: (moduleSpecifier) =>
        moduleSpecifier === './ManagementModals' ? childPath : undefined,
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

    expect(transformed).toContain('"bulkUploadOpen": false');
    expect(transformed).toContain('"deleteTarget": null');
    expect(transformed).toContain('"editTarget": null');
    expect(transformed).toContain('"uploadTarget": null');
    expect(transformed).toContain(
      '"requiredPaths":["requestUpload","bulkUploadOpen","deleteTarget","editTarget","uploadTarget"]',
    );
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

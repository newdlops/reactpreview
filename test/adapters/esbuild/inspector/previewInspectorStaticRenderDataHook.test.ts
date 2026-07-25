/**
 * Verifies syntax-only recognition of hook modules that own substantial authored render catalogs.
 */
import { describe, expect, it } from 'vitest';
import { hasPreviewInspectorStaticRenderDataHook } from '../../../../src/adapters/esbuild/inspector/previewInspectorStaticRenderDataHook';

describe('hasPreviewInspectorStaticRenderDataHook', () => {
  /** Retains navigation records even when a compact/filter helper wraps the returned array. */
  it('recognizes an authored navigation catalog returned by a project hook', () => {
    const source = [
      `import compact from 'lodash/compact';`,
      `import { usePermission } from './permission';`,
      `export const useNavigationData = () => {`,
      `  const allowed = usePermission();`,
      `  return compact([`,
      `    { name: 'Home', pageGroups: [{ pages: [{ label: 'Dashboard', path: '/home' }] }] },`,
      `    allowed && { name: 'Reports', pageGroups: [{ pages: [{ label: 'Payroll', path: '/payroll' }] }] },`,
      `  ]);`,
      `};`,
    ].join('\n');

    expect(
      hasPreviewInspectorStaticRenderDataHook('/workspace/use-navigation-data.ts', source, [
        'useNavigationData',
      ]),
    ).toBe(true);
  });

  /** Follows a local return alias while preserving the same bounded syntax-only decision. */
  it('recognizes a catalog stored in a local constant before return', () => {
    const source = [
      `const useColumns = () => {`,
      `  const columns = [`,
      `    { label: 'Employee', name: 'employee' },`,
      `    { label: 'Salary', name: 'salary' },`,
      `  ];`,
      `  return columns;`,
      `};`,
      `export { useColumns };`,
    ].join('\n');

    expect(
      hasPreviewInspectorStaticRenderDataHook('/workspace/use-columns.ts', source, ['useColumns']),
    ).toBe(true);
  });

  /** Stops after positive evidence so a production-sized menu cannot exhaust the syntax budget. */
  it('recognizes a large catalog without traversing every remaining record', () => {
    const trailingRecords = Array.from(
      { length: 600 },
      (_, index) => `{ name: 'item-${index.toString()}', label: 'Detail ${index.toString()}' }`,
    ).join(',');
    const source = [
      `export const useLargeNavigationData = () => [`,
      `  { name: 'Home', label: 'Dashboard' },`,
      `  { name: 'Reports', label: 'Payroll' },`,
      `  ${trailingRecords}`,
      `];`,
    ].join('\n');

    expect(
      hasPreviewInspectorStaticRenderDataHook('/workspace/use-large-navigation-data.ts', source, [
        'useLargeNavigationData',
      ]),
    ).toBe(true);
  });

  /** Ordinary backend/state hooks remain generated boundaries even if they return a small object. */
  it('rejects a small runtime state result', () => {
    const source = [
      `export function useSession() {`,
      `  return { name: 'Preview user', status: 'active' };`,
      `}`,
    ].join('\n');

    expect(
      hasPreviewInspectorStaticRenderDataHook('/workspace/use-session.ts', source, ['useSession']),
    ).toBe(false);
  });

  /** A non-hook component/config export cannot opt into authentic hook traversal by shape alone. */
  it('rejects non-hook exports', () => {
    const source = [
      `export const navigationData = [`,
      `  { name: 'Home', label: 'Dashboard' },`,
      `  { name: 'Reports', label: 'Payroll' },`,
      `];`,
    ].join('\n');

    expect(
      hasPreviewInspectorStaticRenderDataHook('/workspace/navigation.ts', source, [
        'navigationData',
      ]),
    ).toBe(false);
  });
});

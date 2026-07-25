/**
 * Verifies that custom-hook projection preserves authored computation and cuts only direct leaves.
 */
import { describe, expect, it } from 'vitest';
import { hasPreviewInspectorAuthoredHookLogic } from '../../../../src/adapters/esbuild/inspector/previewInspectorAuthoredHookLogic';

describe('hasPreviewInspectorAuthoredHookLogic', () => {
  /** Collection transforms create the actual component-facing value and must remain authentic. */
  it('retains filtering and mapping above an external hook result', () => {
    const source = [
      `import { useBackendRows } from './use-backend-rows';`,
      `export function useVisibleRows() {`,
      `  const { rows } = useBackendRows();`,
      `  return rows.filter((row) => row.visible).map((row) => ({`,
      `    ...row,`,
      `    label: row.name.trim(),`,
      `  }));`,
      `}`,
    ].join('\n');

    expect(
      hasPreviewInspectorAuthoredHookLogic('/workspace/use-visible-rows.ts', source, [
        'useVisibleRows',
      ]),
    ).toBe(true);
  });

  /** A direct external hook pass-through remains the inexpensive data/effect projection leaf. */
  it('projects a direct hook call and its transparent property alias', () => {
    const direct = [
      `import { useBackendRows } from './use-backend-rows';`,
      `export const useRows = () => useBackendRows();`,
    ].join('\n');
    const property = [
      `import { useBackendRows } from './use-backend-rows';`,
      `export const useRows = () => {`,
      `  const query = useBackendRows();`,
      `  const data = query.data;`,
      `  return data;`,
      `};`,
    ].join('\n');

    expect(
      hasPreviewInspectorAuthoredHookLogic('/workspace/use-rows.ts', direct, ['useRows']),
    ).toBe(false);
    expect(
      hasPreviewInspectorAuthoredHookLogic('/workspace/use-rows.ts', property, ['useRows']),
    ).toBe(false);
  });

  /** Defaults and control flow select visible branches even when final values are property aliases. */
  it('retains destructuring defaults and authored return branches', () => {
    const withDefault = [
      `import { useBackendRows } from './use-backend-rows';`,
      `export function useRows() {`,
      `  const { rows = [] } = useBackendRows();`,
      `  return rows;`,
      `}`,
    ].join('\n');
    const withBranch = [
      `import { useBackendRows } from './use-backend-rows';`,
      `export function useRows() {`,
      `  const query = useBackendRows();`,
      `  if (query.loading) return query.previousData;`,
      `  return query.data;`,
      `}`,
    ].join('\n');

    expect(
      hasPreviewInspectorAuthoredHookLogic('/workspace/use-rows.ts', withDefault, ['useRows']),
    ).toBe(true);
    expect(
      hasPreviewInspectorAuthoredHookLogic('/workspace/use-rows.ts', withBranch, ['useRows']),
    ).toBe(true);
  });

  /** Selector/useMemo callbacks are part of the returned calculation, not opaque hook arguments. */
  it('retains transforming callbacks passed to a direct hook call', () => {
    const source = [
      `import { useSelector } from './store';`,
      `export default function useActiveNames() {`,
      `  return useSelector((state) =>`,
      `    state.users.filter((user) => user.active).map((user) => user.name),`,
      `  );`,
      `}`,
    ].join('\n');

    expect(
      hasPreviewInspectorAuthoredHookLogic('/workspace/use-active-names.ts', source, ['default']),
    ).toBe(true);
  });

  /** Pure argument-driven helpers named as hooks retain their authored computation without data IO. */
  it('retains a pure custom hook that derives a view model from its parameter', () => {
    const source = [
      `export const useOptions = (items: readonly { id: string; name: string }[]) =>`,
      `  items.map((item) => ({ value: item.id, label: item.name }));`,
    ].join('\n');

    expect(
      hasPreviewInspectorAuthoredHookLogic('/workspace/use-options.ts', source, ['useOptions']),
    ).toBe(true);
  });

  /** Side-effect-only hooks with no component-facing return stay replaceable by inert actions. */
  it('projects a side-effect-only hook with no returned value', () => {
    const source = [
      `import { useEffect } from 'react';`,
      `import { subscribe } from './events';`,
      `export function useSubscription() {`,
      `  useEffect(() => subscribe(), []);`,
      `}`,
    ].join('\n');

    expect(
      hasPreviewInspectorAuthoredHookLogic('/workspace/use-subscription.ts', source, [
        'useSubscription',
      ]),
    ).toBe(false);
  });

  /** A barrel is a routing node whose concrete hook body must be classified on the next DFS edge. */
  it('retains an explicit demanded hook re-export for recursive classification', () => {
    const source = [
      `export type { VisibleRow } from './use-visible-rows';`,
      `export { useVisibleRows } from './use-visible-rows';`,
    ].join('\n');

    expect(
      hasPreviewInspectorAuthoredHookLogic('/workspace/hooks.ts', source, ['useVisibleRows']),
    ).toBe(true);
  });

  /** React-local controller state remains coherent through the unified authored-hook policy. */
  it('retains local state and its returned modal actions', () => {
    const source = [
      `import { useCallback, useState } from 'react';`,
      `export const useModalActions = () => {`,
      `  const [show, setShow] = useState(false);`,
      `  const open = useCallback(() => setShow(true), [setShow]);`,
      `  const close = useCallback(() => setShow(false), [setShow]);`,
      `  return [{ show, onClose: close }, { open, close }];`,
      `};`,
    ].join('\n');

    expect(
      hasPreviewInspectorAuthoredHookLogic('/workspace/use-modal-actions.ts', source, [
        'useModalActions',
      ]),
    ).toBe(true);
  });
});

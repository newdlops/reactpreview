/** Exercises the source-proven prop choice control without mounting authored React. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorPropsUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPropsUiRuntimeSource';

interface TestElement {
  readonly children: readonly unknown[];
  readonly props: Record<string, unknown>;
  readonly type: unknown;
}

/** Finds the first host element of one type in a minimal React element tree. */
function findElement(root: unknown, type: string): TestElement | undefined {
  if (root === null || typeof root !== 'object') return undefined;
  const element = root as TestElement;
  if (element.type === type) return element;
  for (const child of element.children ?? []) {
    if (Array.isArray(child)) {
      for (const nested of child) {
        const found = findElement(nested, type);
        if (found !== undefined) return found;
      }
      continue;
    }
    const found = findElement(child, type);
    if (found !== undefined) return found;
  }
  return undefined;
}

describe('Preview Inspector props UI runtime source', () => {
  it('applies one typed source choice while preserving unrelated manual JSON', () => {
    const sandbox: {
      __draftText?: string;
      __fallbackModes?: unknown[];
      __result?: TestElement;
      __storedOverride?: Readonly<Record<string, unknown>>;
    } = {};
    vm.runInNewContext(
      `
        let draftText = '';
        let stateIndex = 0;
        const fallbackModes = [];
        let storedOverride = {};
        const React = {
          createElement: (type, props, ...children) => ({ children, props: props ?? {}, type }),
          useEffect: () => undefined,
          useState: (initial) => {
            const currentIndex = stateIndex;
            stateIndex += 1;
            let value = typeof initial === 'function' ? initial() : initial;
            return [value, (next) => {
              value = typeof next === 'function' ? next(value) : next;
              if (currentIndex === 0 && typeof value === 'string') draftText = value;
            }];
          },
        };
        const PREVIEW_INSPECTOR_COMPONENT_VALUE_SENTINEL = '[Preview component]';
        const PREVIEW_INSPECTOR_NOOP_VALUE_SENTINEL = '[Preview no-op function]';
        const PreviewInspectorDevtoolsButton = 'button';
        const previewInspectorSession = {
          overridesByExport: new Map([['TaxTypeBadge', { title: 'Keep me' }]]),
        };
        const applyPreviewInspectorSmartProps = () => ({ value: {} });
        const copyPreviewInspectorBlockerValueForJson = (value) => value;
        const createPreviewInspectorSmartPropsDraft = () => ({
          generatedPaths: ['taxType'],
          value: { taxType: 'taxType', title: 'Observed title' },
        });
        const hasPreviewInspectorSmartPropsDraft = () => true;
        const isPreviewInspectorUiNodeEditable = () => true;
        const normalizePreviewInspectorProps = (value) => value;
        const readPreviewInspectorSmartPropChoiceRecords = () => [{
          candidates: ['heavy_tax', 'fixed_tax', 'normal_tax'],
          currentValue: 'taxType',
          path: 'taxType',
          userControlled: false,
        }];
        const resetPreviewInspectorPropsOverride = () => undefined;
        const setPreviewInspectorFallbackValuesEnabled = (...args) => {
          fallbackModes.push(args);
        };
        const setPreviewInspectorPropsOverride = (_exportName, value) => {
          storedOverride = value;
        };
        const setPreviewInspectorSmartPropPathValue = (value, path, nextValue) => ({
          ...value,
          [path]: nextValue,
        });
        const applyPreviewInspectorSmartPropChoice = (exportName, choice, selectedValue) => {
          const userProps = previewInspectorSession.overridesByExport.get(exportName) ?? {};
          const nextOverride = setPreviewInspectorSmartPropPathValue(
            userProps,
            choice.path,
            selectedValue,
          );
          setPreviewInspectorFallbackValuesEnabled(true, false);
          setPreviewInspectorPropsOverride(exportName, nextOverride);
          return nextOverride;
        };
        const stringifyPreviewInspectorProps = (value) => JSON.stringify(value, null, 2);
        ${createPreviewInspectorPropsUiRuntimeSource()}
        const result = PreviewInspectorPropsDetail({
          node: { exportName: 'TaxTypeBadge', id: 'target:TaxTypeBadge' },
        });
        const select = (${findElement.toString()})(result, 'select');
        select.props.onChange({ target: { value: '2' } });
        globalThis.__result = result;
        globalThis.__draftText = draftText;
        globalThis.__fallbackModes = fallbackModes;
        globalThis.__storedOverride = storedOverride;
      `,
      sandbox,
    );

    const select = findElement(sandbox.__result, 'select');
    expect(select?.props).toMatchObject({
      'aria-label': 'Preview value for taxType',
      value: '',
    });
    expect(sandbox.__storedOverride).toEqual({
      taxType: 'normal_tax',
      title: 'Keep me',
    });
    expect(sandbox.__fallbackModes).toEqual([[true, false]]);
    expect(sandbox.__draftText).toContain('"taxType": "normal_tax"');
  });
});

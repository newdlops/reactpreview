/**
 * Verifies demand-shaped custom Context-hook fallbacks independently from source-transformer
 * integration. Tests retain generated declarations and replacements so stability, freezing,
 * provider precedence, inference boundaries, and source offsets remain directly observable.
 */
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  createReactContextHookFallbackTransform,
  type ReactContextHookFallbackTransform,
} from '../../../../src/adapters/esbuild/staticResources/reactContextHookFallback';

describe('createReactContextHookFallbackTransform', () => {
  /** Reproduces the Form Context shape required by the reported acquisition-period component. */
  it('infers nested containers and called leaves through destructuring, aliases, and closures', () => {
    const source = [
      `import { useFormContext } from 'common/ui/form/form-context';`,
      'export function AcquisitionPeriodRow() {',
      '  const { formikProps } = useFormContext<FormValue>();',
      '  const values = formikProps.values;',
      '  const update = () => {',
      '    if (values.exercisePeriod > 0) formikProps.setValues(values);',
      '  };',
      '  return values.acquisitionPeriod;',
      '}',
    ].join('\n');

    const transform = createReactContextHookFallbackTransform('/workspace/row.tsx', source);

    expect(transform.replacements).toHaveLength(1);
    expect(transform.replacements[0]?.replacement).toContain(
      'useFormContext<FormValue>() ?? __reactPreviewContextHookFallback0',
    );
    expect(transform.declarations).toEqual([
      'const __reactPreviewContextHookFallback0 = Object.freeze({ "formikProps": Object.freeze({ "setValues": Object.freeze(() => undefined), "values": Object.freeze({}) }) });',
    ]);
    expect(applyTransform(source, transform)).toContain(
      '(useFormContext<FormValue>() ?? __reactPreviewContextHookFallback0)',
    );
  });

  /** Covers aliased named imports, namespace imports, direct aliases, and called identifiers. */
  it('supports static import aliases and namespace Context hooks', () => {
    const source = [
      `import { useDialogContext as readDialog } from './dialog-context';`,
      `import * as ContextHooks from './hooks';`,
      'export function First() {',
      '  const dialog = readDialog();',
      '  dialog.controls.close();',
      '  return dialog.title;',
      '}',
      'export function Second() {',
      '  const { submit } = ContextHooks.useFormContext();',
      '  submit();',
      '  return null;',
      '}',
    ].join('\n');

    const transform = createReactContextHookFallbackTransform('/workspace/aliases.tsx', source);

    expect(transform.replacements).toHaveLength(2);
    expect(transform.declarations.join('\n')).toContain(
      '"controls": Object.freeze({ "close": Object.freeze(() => undefined) })',
    );
    expect(transform.declarations.join('\n')).toContain('"submit": Object.freeze(() => undefined)');
  });

  /** Propagates an object requirement through a bounded local helper into a nested destructure. */
  it('uses local Object.keys helper evidence to materialize an otherwise leaf object', () => {
    const source = [
      `import { useFormContext } from './form-context';`,
      'const getKeys = (value: unknown) => Object.keys(value as object);',
      'export function useFocusOnError() {',
      '  const {',
      '    options: { focusOnError },',
      '    formikProps: { errors, isValid },',
      '  } = useFormContext();',
      '  const firstKey = getKeys(errors)[0];',
      '  return focusOnError && !isValid ? firstKey : undefined;',
      '}',
    ].join('\n');

    const transform = createReactContextHookFallbackTransform('/workspace/focus.tsx', source);

    expect(transform.replacements).toHaveLength(1);
    expect(transform.declarations).toEqual([
      'const __reactPreviewContextHookFallback0 = Object.freeze({ "formikProps": Object.freeze({ "errors": Object.freeze({}) }), "options": Object.freeze({}) });',
    ]);
  });

  /** Executes generated JavaScript to prove real values win and fallback identities stay frozen. */
  it('preserves a non-null provider value and creates a stable deeply frozen plain fallback', () => {
    const source = [
      `import usePanelContext from './panel-context';`,
      'export function Panel() {',
      '  const panel = usePanelContext();',
      '  panel.actions.dismiss();',
      '  return panel.content.title;',
      '}',
    ].join('\n');
    const transform = createReactContextHookFallbackTransform('/workspace/panel.js', source);
    const replacement = transform.replacements[0];
    const declaration = transform.declarations[0];
    if (replacement === undefined || declaration === undefined) {
      throw new Error('Expected one generated Context-hook fallback.');
    }

    const sandbox: {
      hookValue?: unknown;
      read?: () => Record<string, unknown>;
    } = { hookValue: undefined };
    const context = createContext(sandbox);
    runInContext(
      `${declaration}\nglobalThis.read = () => (globalThis.hookValue ?? ${replacement.fallbackBinding});`,
      context,
    );
    const evaluate = (): Record<string, unknown> => {
      const read = sandbox.read;
      if (read === undefined) throw new Error('Generated fallback reader was not initialized.');
      return read();
    };
    const providerValue = { actions: { dismiss: () => 'real' }, content: { title: 'real' } };
    const firstFallback = evaluate();
    const secondFallback = evaluate();

    sandbox.hookValue = providerValue;
    expect(evaluate()).toBe(providerValue);
    expect(firstFallback).toBe(secondFallback);
    expect(Object.isFrozen(firstFallback)).toBe(true);
    expect(Object.isFrozen(firstFallback.actions)).toBe(true);
    expect(Object.isFrozen((firstFallback.actions as { dismiss: unknown }).dismiss)).toBe(true);
  });

  /** Rejects operations whose shape cannot be represented by plain containers and no-op leaves. */
  it('fails closed for optional, computed, array-bound, conflicting, and shadowed hooks', () => {
    const fixtures = [
      [
        `import { useFormContext } from './context';`,
        'function View() { const value = useFormContext(); return value?.name; }',
      ],
      [
        `import { useFormContext } from './context';`,
        'function View({ keyName }) { const value = useFormContext(); return value[keyName].name; }',
      ],
      [
        `import { useFormContext } from './context';`,
        'function View() { const [first] = useFormContext(); return first; }',
      ],
      [
        `import { useFormContext } from './context';`,
        'function View() { const value = useFormContext(); value.service(); return value.service.name; }',
      ],
      [
        `import { useFormContext } from './context';`,
        'function View(useFormContext) { return useFormContext().name; }',
      ],
    ];

    for (const [index, lines] of fixtures.entries()) {
      const transform = createReactContextHookFallbackTransform(
        `/workspace/unsafe-${index.toString()}.tsx`,
        lines.join('\n'),
      );
      expect(transform).toEqual({ declarations: [], replacements: [] });
    }
  });

  /** Leaves primitive leaves absent and blocks prototype-sensitive property materialization. */
  it('does not invent leaf values or prototype-sensitive paths', () => {
    const leafSource = [
      `import { useAppContext } from './app-context';`,
      'function View() { const { isStaffMode } = useAppContext(); return isStaffMode; }',
    ].join('\n');
    const unsafeSource = [
      `import { useAppContext } from './app-context';`,
      `function View() { const value = useAppContext(); return value['__proto__'].name; }`,
    ].join('\n');

    expect(
      createReactContextHookFallbackTransform('/workspace/leaf.tsx', leafSource).declarations,
    ).toEqual(['const __reactPreviewContextHookFallback0 = Object.freeze({});']);
    expect(createReactContextHookFallbackTransform('/workspace/unsafe.tsx', unsafeSource)).toEqual({
      declarations: [],
      replacements: [],
    });
  });
});

/** Applies generated source ranges right-to-left and appends their stable module declarations. */
function applyTransform(source: string, transform: ReactContextHookFallbackTransform): string {
  let rewritten = source;
  for (const replacement of [...transform.replacements].sort(
    (left, right) => right.start - left.start,
  )) {
    rewritten = `${rewritten.slice(0, replacement.start)}${replacement.replacement}${rewritten.slice(replacement.end)}`;
  }
  return `${rewritten}\n${transform.declarations.join('\n')}`;
}

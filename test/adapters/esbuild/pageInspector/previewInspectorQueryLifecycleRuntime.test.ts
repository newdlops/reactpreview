/** Exercises emitted JSX guards with the production condition runtime across real query states. */
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { instrumentReactConditionalRendering } from '../../../../src/adapters/esbuild/staticResources/reactConditionalRendering';
import { createConditionRuntimeHarness } from './support/previewInspectorConditionRuntimeFixture';

describe('query lifecycle guard runtime', () => {
  it('renders pending, populated and error states without bypassing into undefined.length', () => {
    const harness = createConditionRuntimeHarness({}, () => undefined);
    let current: { data: string[] | undefined; status: string } = {
      data: undefined,
      status: 'pending',
    };
    const source = instrumentReactConditionalRendering(
      '/workspace/Rows.tsx',
      `
      export function Rows() {
        const { data: records, status } = useRows();
        if (status === 'pending') return <p>LOADING</p>;
        if (status === 'error') return <p>RETRY</p>;
        return <main>{records.length}:{records.map(row => <span key={row}>{row}</span>)}</main>;
      }`,
    );
    const module = { exports: {} as { Rows?: React.ComponentType } };
    const context = vm.createContext({
      React,
      module,
      exports: module.exports,
      useRows: () => current,
    });
    vm.runInContext(
      `globalThis[Symbol.for('newdlops.react-file-preview.page-inspector')] = api;`,
      Object.assign(context, {
        api: {
          resolveRenderCondition: harness.resolveCondition,
          resolveRenderConditionLazy: harness.resolveConditionLazy,
        },
      }),
    );
    vm.runInContext(
      transformSync(source, { format: 'cjs', loader: 'tsx', jsx: 'transform' }).code,
      context,
    );
    const Rows = module.exports.Rows;
    if (Rows === undefined) throw new Error('The emitted component export is missing.');
    const render = (): string => renderToStaticMarkup(React.createElement(Rows));
    expect(render()).toContain('LOADING');
    const pending = harness
      .readConditions()
      .find((record) => record.authoredExpression === "status === 'pending'");
    expect(pending?.requiresAuthoredState).toBe(true);
    expect(harness.setAutoCondition(String(pending?.id), false)).toBe(false);
    harness.setCondition(String(pending?.id), false);
    expect(render()).toContain('LOADING');
    current = { data: ['first', 'second'], status: 'success' };
    expect(render()).toContain('<main>2:<span>first</span><span>second</span></main>');
    current = { data: undefined, status: 'error' };
    expect(render()).toContain('RETRY');
  });
});

/** Verifies which JSX conditions are marked as reading only their component's own UI state. */
import { describe, expect, it } from 'vitest';
import { instrumentReactConditionalRendering } from '../../../../src/adapters/esbuild/staticResources/reactConditionalRendering';

/** Maps each instrumented authored condition to whether its metadata carries `stateBound`. */
function readStateBound(source: string): Readonly<Record<string, boolean>> {
  const definitions: string[] = [];
  instrumentReactConditionalRendering('/workspace/src/Panel.tsx', source, definitions);
  // Each metadata record starts with its authored expression, so a segment ends at the next one.
  const segments = definitions.join('\n').split('"authoredExpression":').slice(1);
  return Object.fromEntries(
    segments.map((segment) => {
      const expression = /^("(?:\\.|[^"\\])*")/u.exec(segment)?.[1];
      return [JSON.parse(expression ?? '""') as string, segment.includes('"stateBound":true')];
    }),
  );
}

describe('React condition state binding', () => {
  /** Tabs and steps switch authored screens; a data delta displays the data itself. */
  it('marks conditions over local useState/useReducer values and module constants', () => {
    const source = [
      "import React, { useReducer, useState } from 'react';",
      "const STEPS = ['account', 'team', 'done'];",
      'export function Panel({ atRiskDelta, rows }) {',
      "  const [tab, setTab] = useState('overview');",
      '  const [step] = React.useState(0);',
      '  const [state, dispatch] = useReducer(reduce, { open: false });',
      '  const total = rows.length;',
      "  const renderTabs = () => (tab === 'billing' ? <Billing /> : null);",
      '  return <main>',
      '    {renderTabs()}',
      "    {tab === 'members' && <Members />}",
      '    {step === 2 && <Summary />}',
      '    {step === STEPS.length - 1 && <Finish />}',
      '    {state.open && <Dialog />}',
      '    {atRiskDelta !== 0 && <Delta />}',
      "    {total === 0 || tab === 'members' ? <Empty /> : null}",
      '  </main>;',
      '}',
    ].join('\n');

    expect(readStateBound(source)).toEqual({
      "tab === 'billing'": true,
      "tab === 'members'": true,
      'step === 2': true,
      'step === STEPS.length - 1': true,
      'state.open': true,
      'atRiskDelta !== 0': false,
      "total === 0 || tab === 'members'": false,
    });
  });

  /** A nested component's own state does not bind the outer component's condition. */
  it('reads state only from the function that owns the condition', () => {
    const source = [
      "import { useState } from 'react';",
      'export function Panel({ open }) {',
      '  function Inner() {',
      '    const [open, setOpen] = useState(false);',
      '    return <button onClick={() => setOpen(true)}>{String(open)}</button>;',
      '  }',
      '  return <main>{open && <Dialog />}<Inner /></main>;',
      '}',
    ].join('\n');

    expect(readStateBound(source)).toEqual({ open: false });
  });
});

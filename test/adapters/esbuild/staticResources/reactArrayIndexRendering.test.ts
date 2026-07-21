/** Verifies static render choices for JSX arrays selected by query, state, or prop indexes. */
import { describe, expect, it } from 'vitest';
import { instrumentReactArrayIndexRendering } from '../../../../src/adapters/esbuild/staticResources/reactArrayIndexRendering';

describe('instrumentReactArrayIndexRendering', () => {
  /** Exposes every fixed wizard step as a numeric choice with component-path evidence. */
  it('instruments a component-local JSX array selected through a dynamic index', () => {
    const source = [
      'export default function OnboardingPage({ step }) {',
      '  const steps = [',
      '    <Step0 key={0} />,',
      '    <Step1 key={1} />,',
      '    <Step2 key={2} />,',
      '  ];',
      '  return <main>{steps[step]}</main>;',
      '}',
    ].join('\n');

    const transformed = instrumentReactArrayIndexRendering('/workspace/Onboarding.tsx', source);

    expect(transformed).toContain('.resolveRenderChoice(');
    expect(transformed).toContain('(step)');
    expect(transformed).toContain('"kind":"array-index"');
    expect(transformed).toContain('"calls":["Step0"]');
    expect(transformed).toContain('"calls":["Step1"]');
    expect(transformed).toContain('"value":2');
  });

  /** Chooses the nearest block binding instead of borrowing metadata from a same-name outer array. */
  it('resolves same-name JSX arrays by lexical scope', () => {
    const source = [
      'function Page({ index, nested }) {',
      '  const steps = [<Outer0 />, <Outer1 />];',
      '  if (nested) {',
      '    const steps = [<Inner0 />, <Inner1 />, <Inner2 />];',
      '    return steps[index];',
      '  }',
      '  return null;',
      '}',
    ].join('\n');

    const transformed = instrumentReactArrayIndexRendering('/workspace/Page.tsx', source);

    expect(transformed.match(/\.resolveRenderChoice\(/gu)).toHaveLength(1);
    expect(transformed).toContain('"calls":["Inner0"]');
    expect(transformed).toContain('"calls":["Inner2"]');
    expect(transformed).not.toContain('"calls":["Outer0"]');
    expect(transformed).toContain('"value":2');
  });

  /** Fails closed when application code can mutate the array binding after its declaration. */
  it('leaves reassigned and non-render arrays unchanged', () => {
    const reassigned = [
      'function Page({ index }) {',
      '  let steps = [<First />, <Second />];',
      '  steps = buildSteps();',
      '  return steps[index];',
      '}',
    ].join('\n');
    const dataArray = [
      'function Page({ index }) {',
      '  const values = [1, 2, 3];',
      '  return <span>{values[index]}</span>;',
      '}',
    ].join('\n');

    expect(instrumentReactArrayIndexRendering('/workspace/Page.tsx', reassigned)).toBe(reassigned);
    expect(instrumentReactArrayIndexRendering('/workspace/Page.tsx', dataArray)).toBe(dataArray);
  });

  /** Fails closed for native mutators and direct element/length writes that stale branch metadata. */
  it('leaves mutated JSX arrays unchanged', () => {
    const mutations = [
      'steps.pop();',
      'steps.push(<Third />);',
      'steps.splice(0, 1);',
      'steps[index] = <Replacement />;',
      'steps.length = 1;',
    ];

    for (const mutation of mutations) {
      const source = [
        'function Page({ index }) {',
        '  const steps = [<First />, <Second />];',
        `  ${mutation}`,
        '  return steps[index];',
        '}',
      ].join('\n');

      expect(instrumentReactArrayIndexRendering('/workspace/Page.tsx', source)).toBe(source);
    }
  });

  /** Keeps the transform idempotent when a cached/intermediate source is presented a second time. */
  it('does not wrap an existing Inspector render choice again', () => {
    const source = [
      'function Page({ index }) {',
      '  const steps = [<First />, <Second />];',
      '  return steps[index];',
      '}',
    ].join('\n');

    const first = instrumentReactArrayIndexRendering('/workspace/Page.tsx', source);
    const second = instrumentReactArrayIndexRendering('/workspace/Page.tsx', first);

    expect(second).toBe(first);
    expect(second.match(/\.resolveRenderChoice\(/gu)).toHaveLength(1);
  });
});

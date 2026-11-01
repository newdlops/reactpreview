/** Guards lexical handler proofs and bounded reuse of immutable deferred-UI scope syntax. */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { instrumentPreviewDeferredUiTriggers } from '../../../../src/adapters/esbuild/staticResources/previewDeferredUiTriggerInstrumentation';
import { createPreviewRuntimeSourceSyntax } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeSourceSyntax';

const SOURCE_PATH = '/workspace/Panel.tsx';
const OUTER_HANDLER = 'const handle = () => modal.open();';

describe('deferred UI handler lexical scope', () => {
  it.each([
    ['parameter', 'function Panel(handle) { return <button onClick={handle} />; }'],
    [
      'destructured parameter',
      'function Panel({ handle }) { return <button onClick={handle} />; }',
    ],
    [
      'mutable local',
      'function Panel() { let handle = other; return <button onClick={handle} />; }',
    ],
    [
      'legacy local',
      'function Panel() { var handle = other; return <button onClick={handle} />; }',
    ],
    [
      'opaque const',
      'function Panel() { const handle = factory(); return <button onClick={handle} />; }',
    ],
    [
      'destructured local',
      'function Panel(props) { const { handle } = props; return <button onClick={handle} />; }',
    ],
    ['class local', 'function Panel() { class handle {} return <button onClick={handle} />; }'],
    [
      'later const',
      'function Panel() { return <button onClick={handle} />; const handle = other; }',
    ],
    [
      'loop binding',
      'function Panel(items) { for (const handle of items) { return <button onClick={handle} />; } }',
    ],
    [
      'catch binding',
      'function Panel() { try { work(); } catch (handle) { return <button onClick={handle} />; } }',
    ],
    [
      'named expression',
      'const Panel = function handle() { return <button onClick={handle} />; };',
    ],
    [
      'hoisted var',
      'function Panel() { if (flag) { var handle = other; } return <button onClick={handle} />; }',
    ],
    [
      'switch binding',
      'function Panel(flag) { switch (flag) { case 1: const handle = other; case 2: return <button onClick={handle} />; } }',
    ],
    [
      'enum binding',
      'function Panel() { enum handle { Other } return <button onClick={handle} />; }',
    ],
    [
      'array binding',
      'function Panel(props) { const [handle] = props; return <button onClick={handle} />; }',
    ],
    [
      'namespace binding',
      'namespace Nested { const handle = billing.submit; export function Panel() { return <button onClick={handle} />; } }',
    ],
    [
      'namespace var',
      'namespace Nested { if (flag) { var handle = other; } export function Panel() { return <button onClick={handle} />; } }',
    ],
    [
      'class static var',
      'class Box { static { if (flag) { var handle = other; } Box.view = <button onClick={handle} />; } }',
    ],
  ])('does not borrow outer proof through a shadowing %s', (_name, component) => {
    const result = instrumentPreviewDeferredUiTriggers(
      SOURCE_PATH,
      `${OUTER_HANDLER}\n${component}`,
    );
    expect(result).toEqual({ registrations: [], replacements: [] });
  });

  it('resolves an outer closure in its declaration scope when the event has a different local alias', () => {
    const source = `const reveal = billing.submit;
      const handle = () => reveal();
      function Panel({ modal }) {
        const reveal = modal.open;
        return <button onClick={handle} />;
      }`;
    expect(instrumentPreviewDeferredUiTriggers(SOURCE_PATH, source)).toEqual({
      registrations: [],
      replacements: [],
    });
  });

  it('retains a proven outer closure even when the event scope shadows its internal alias', () => {
    const source = `const reveal = modal.open;
      const handle = () => reveal();
      function Panel() {
        const reveal = billing.submit;
        return <button onClick={handle} />;
      }`;
    const result = instrumentPreviewDeferredUiTriggers(SOURCE_PATH, source);
    expect(result.registrations).toHaveLength(1);
    expect(result.registrations[0]).toContain('"methodName":"open"');
    expect(result.registrations[0]).toContain('"invocationSafe":true');
  });

  it('does not use an outer useState tuple for a callback parameter with the same setter name', () => {
    const source = `function Panel({ callbacks }) {
      const [open, setOpen] = useState(false);
      return callbacks.map(setOpen => <button onClick={() => setOpen(true)} />);
    }`;
    expect(instrumentPreviewDeferredUiTriggers(SOURCE_PATH, source)).toEqual({
      registrations: [],
      replacements: [],
    });
  });

  it('keeps local setter aliases, hoisted functions and callback-owned state separate', () => {
    const source = `function Panel() {
      const [open, setOpen] = useState(false);
      const activate = () => setOpen(true);
      const event = activate;
      return <><button onClick={event} /><button onClick={reveal} /></>;
      function reveal() { return modal.show(); }
    }`;
    const registrations = instrumentPreviewDeferredUiTriggers(SOURCE_PATH, source).registrations;
    expect(registrations).toHaveLength(2);
    expect(registrations[0]).toContain('"stateName":"open"');
    expect(registrations[1]).toContain('"methodName":"show"');
  });

  it.each([
    ['setter', 'setSelected'],
    ['argument', 'entry'],
  ])('does not relocate a state transition into a different %s binding', (_name, parameter) => {
    const source = `function Panel({ callbacks }) {
      const [selected, setSelected] = useState(null);
      const entry = { id: 1 };
      const activate = () => setSelected(entry);
      return callbacks.map(${parameter} => <button onClick={activate} />);
    }`;
    expect(instrumentPreviewDeferredUiTriggers(SOURCE_PATH, source)).toEqual({
      registrations: [],
      replacements: [],
    });
  });

  it('retains a type-wrapped useState callee without evaluating the type expression', () => {
    const source = `function Panel() {
      const [open, setOpen] = (React.useState as typeof useState)(false);
      return <button onClick={() => setOpen(true)} />;
    }`;
    const registrations = instrumentPreviewDeferredUiTriggers(SOURCE_PATH, source).registrations;
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toContain('"stateName":"open"');
  });

  it.each(['let', 'var'])('retains a never-reassigned %s useState setter', (declaration) => {
    const source = `function Panel() {
      ${declaration} [open, setOpen] = useState(false);
      return <button onClick={() => setOpen(true)} />;
    }`;
    const registrations = instrumentPreviewDeferredUiTriggers(SOURCE_PATH, source).registrations;
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toContain('"stateName":"open"');
  });

  it('distinguishes different later-initialized arguments when checking replay identity', () => {
    const source = `const first = 1, second = 2; function Panel() {
      const [selected, setSelected] = useState(null);
      const activate = () => setSelected(entry);
      const view = (() => {
        const result = <button onClick={activate} />;
        const entry = second;
        return result;
      })();
      const entry = first;
      return view;
    }`;
    expect(instrumentPreviewDeferredUiTriggers(SOURCE_PATH, source)).toEqual({
      registrations: [],
      replacements: [],
    });
  });

  it('does not hoist namespace-local vars into the outer module', () => {
    const source = `${OUTER_HANDLER}
      namespace Nested { if (flag) { var handle = other; } }
      function Panel() { return <button onClick={handle} />; }`;
    expect(instrumentPreviewDeferredUiTriggers(SOURCE_PATH, source).registrations).toHaveLength(1);
  });

  it('reuses complete write scans across many JSX events without skipping nested reassignment', () => {
    const buttons = Array.from({ length: 40 }, () => '<button onClick={handle} />').join('');
    const source = `function Unrelated() { const filler = 1; return filler; }
      function Panel() {
        function handle() { return modal.open(); }
        function replace() { handle = other; }
        return <>${buttons}</>;
      }`;
    const file = ts.createSourceFile(
      SOURCE_PATH,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const unrelated = file.statements[0];
    if (
      unrelated === undefined ||
      !ts.isFunctionDeclaration(unrelated) ||
      unrelated.body === undefined
    )
      throw new Error('Fixture body is missing.');
    const statements = unrelated.body.statements;
    let reads = 0;
    Object.defineProperty(unrelated.body, 'statements', {
      get: () => {
        reads += 1;
        return statements;
      },
    });
    const result = instrumentPreviewDeferredUiTriggers(SOURCE_PATH, source, {
      readSourceFile: () => file,
    });
    expect(result).toEqual({ registrations: [], replacements: [] });
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThanOrEqual(6);
  });

  it('does not carry scope proof across changed source at the same path', () => {
    const syntax = createPreviewRuntimeSourceSyntax();
    const source = `${OUTER_HANDLER}\nfunction Panel() { return <button onClick={handle} />; }`;
    const first = instrumentPreviewDeferredUiTriggers(SOURCE_PATH, source, syntax);
    expect(first.registrations).toHaveLength(1);
    const changed = source.replace('function Panel()', 'function Panel(handle)');
    expect(instrumentPreviewDeferredUiTriggers(SOURCE_PATH, changed, syntax)).toEqual({
      registrations: [],
      replacements: [],
    });
    expect(instrumentPreviewDeferredUiTriggers(SOURCE_PATH, source, syntax)).toEqual(first);
  });

  it.each([
    'handle = other;',
    '[handle] = callbacks;',
    '({ value: handle } = callbacks);',
    '({ handle } = callbacks);',
    'handle++;',
    'for (handle of callbacks) {}',
  ])('preserves conservative rejection of an authored write: %s', (write) => {
    const source = `function Panel() {
      function handle() { return modal.open(); }
      function replace() { ${write} }
      return <button onClick={handle} />;
    }`;
    expect(instrumentPreviewDeferredUiTriggers(SOURCE_PATH, source)).toEqual({
      registrations: [],
      replacements: [],
    });
  });
});

/** Verifies inert, identity-preserving Page Inspector registration of imperative JSX UI triggers. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { instrumentPreviewDeferredUiTriggers } from '../../../../src/adapters/esbuild/staticResources/previewDeferredUiTriggerInstrumentation';
import { applyPreviewSourceReplacements } from '../../../../src/adapters/esbuild/staticResources/previewSourceReplacement';

const SOURCE_PATH = '/workspace/src/DeferredDialog.tsx';

/** Applies one instrumentation result exactly as the production source transformer does. */
function transform(source: string): string {
  const instrumentation = instrumentPreviewDeferredUiTriggers(SOURCE_PATH, source);
  const rewritten = applyPreviewSourceReplacements(source, instrumentation.replacements);
  return [rewritten, ...instrumentation.registrations].join('\n');
}

describe('instrumentPreviewDeferredUiTriggers', () => {
  it('registers direct and inline zero-argument visibility handlers without invoking either one', () => {
    const source = [
      'export function DeferredDialog({ actions, dialogRef }) {',
      '  return <main>',
      '    <button onClick={actions.show}>Show</button>',
      '    <button onMouseDown={() => dialogRef.current?.open()}>Open</button>',
      '  </main>;',
      '}',
    ].join('\n');

    const rewritten = transform(source);

    expect(rewritten.match(/registerDeferredUiTrigger\?\.\(/gu)).toHaveLength(2);
    expect(rewritten.match(/registerDeferredUiTriggerMetadata\?\.\(/gu)).toHaveLength(2);
    expect(rewritten).toContain('registerDeferredUiTrigger?.(__reactPreviewDeferredUiHandler,');
    expect(rewritten).toContain(')(actions.show)');
    expect(rewritten).toContain(')(() => dialogRef.current?.open())');
    expect(rewritten).toContain('"ownerName":"DeferredDialog"');
    expect(rewritten).toContain('"eventName":"onClick"');
    expect(rewritten).toContain('"methodName":"open"');
    expect(rewritten).toContain('"invocationSafe":false');
    expect(rewritten).toContain('"invocationSafe":true');
  });

  it('follows bounded local handler aliases with a single safe expression body', () => {
    const source = [
      'export const Panel = ({ modal }) => {',
      '  const reveal = () => modal.present();',
      '  const handleClick = reveal;',
      '  return <button onClick={handleClick}>Present</button>;',
      '};',
    ].join('\n');

    const instrumentation = instrumentPreviewDeferredUiTriggers(SOURCE_PATH, source);

    expect(instrumentation.replacements).toHaveLength(1);
    expect(instrumentation.registrations).toHaveLength(1);
    expect(instrumentation.registrations[0]).toContain('"methodName":"present"');
    expect(instrumentation.registrations[0]).toContain('"invocationSafe":true');
    expect(instrumentation.registrations[0]).toContain('"ownerName":"Panel"');
  });

  it('follows only immutable aliases and declines reassigned function declarations', () => {
    const source = [
      'export function Panel({ modal, drawer }) {',
      '  let mutable = () => modal.open();',
      '  var legacy = () => drawer.show();',
      '  function replaced() { return modal.present(); }',
      '  replaced = () => undefined;',
      '  const stable = () => modal.show();',
      '  return <>',
      '    <button onClick={mutable}>Mutable</button>',
      '    <button onClick={legacy}>Legacy</button>',
      '    <button onClick={replaced}>Replaced</button>',
      '    <button onClick={stable}>Stable</button>',
      '  </>;',
      '}',
    ].join('\n');

    const instrumentation = instrumentPreviewDeferredUiTriggers(SOURCE_PATH, source);

    expect(instrumentation.registrations).toHaveLength(1);
    expect(instrumentation.registrations[0]).toContain('"expression":"stable"');
    expect(instrumentation.registrations[0]).toContain('"invocationSafe":true');
  });

  it('keeps an unreassigned zero-argument function declaration eligible', () => {
    const source = [
      'export function Panel({ modal }) {',
      '  function openModal() { return modal.open(); }',
      '  return <button onClick={openModal}>Open</button>;',
      '}',
    ].join('\n');

    const instrumentation = instrumentPreviewDeferredUiTriggers(SOURCE_PATH, source);

    expect(instrumentation.registrations).toHaveLength(1);
    expect(instrumentation.registrations[0]).toContain('"expression":"openModal"');
    expect(instrumentation.registrations[0]).toContain('"invocationSafe":true');
  });

  it('resolves repeated handler names only inside their enclosing component scope', () => {
    const source = [
      'export function OpenPanel({ modal }) {',
      '  const handleClick = () => modal.open();',
      '  return <button onClick={handleClick}>Open</button>;',
      '}',
      'export function ShowPanel({ drawer }) {',
      '  const handleClick = () => drawer.show();',
      '  return <button onClick={handleClick}>Show</button>;',
      '}',
    ].join('\n');

    const registrations = instrumentPreviewDeferredUiTriggers(SOURCE_PATH, source).registrations;

    expect(registrations).toHaveLength(2);
    expect(registrations[0]).toContain('"methodName":"open","ownerName":"OpenPanel"');
    expect(registrations[1]).toContain('"methodName":"show","ownerName":"ShowPanel"');
  });

  it('declines handlers requiring arguments, multi-statement bodies, aliases cycles, and non-events', () => {
    const source = [
      'const first = second;',
      'const second = first;',
      'export function Unsafe({ modal }) {',
      '  const withArgument = () => modal.open("edit");',
      '  const multiStep = () => { track(); modal.show(); };',
      '  return <main data-handler={modal.show}>',
      '    <button onClick={withArgument}>Argument</button>',
      '    <button onClick={multiStep}>Multiple</button>',
      '    <button onClick={first}>Cycle</button>',
      '  </main>;',
      '}',
    ].join('\n');

    const instrumentation = instrumentPreviewDeferredUiTriggers(SOURCE_PATH, source);

    expect(instrumentation).toEqual({ registrations: [], replacements: [] });
  });

  it('requires static UI receiver evidence for generic open/show method names', () => {
    const source = [
      'export function Actions({ billing, dangerous, refetch, refresh, modalActions }) {',
      '  return <>',
      '    <button onClick={() => billing.show()}>Billing</button>',
      '    <button onClick={() => dangerous.open()}>Dangerous</button>',
      '    <button onClick={() => refetch.open()}>Refetch</button>',
      '    <button onClick={() => refresh.show()}>Refresh</button>',
      '    <button onClick={() => modalActions.open()}>Modal</button>',
      '  </>;',
      '}',
    ].join('\n');

    const instrumentation = instrumentPreviewDeferredUiTriggers(SOURCE_PATH, source);

    expect(instrumentation.registrations).toHaveLength(1);
    expect(instrumentation.registrations[0]).toContain('modalActions.open()');
  });

  it('returns the exact once-evaluated handler when the runtime throws or returns another value', () => {
    const source = 'export const Button = ({ modal }) => <button onClick={modal.open} />;';
    const [replacement] = instrumentPreviewDeferredUiTriggers(SOURCE_PATH, source).replacements;
    expect(replacement).toBeDefined();
    const originalHandler = (): undefined => undefined;
    for (const behavior of ['throw', 'replace'] as const) {
      const context: Record<string, unknown> = {
        __behavior: behavior,
        __getterReads: 0,
        __handler: originalHandler,
      };
      vm.runInNewContext(
        `
          const modal = { get open() { globalThis.__getterReads += 1; return globalThis.__handler; } };
          globalThis[Symbol.for('newdlops.react-file-preview.page-inspector')] = {
            registerDeferredUiTrigger() {
              if (globalThis.__behavior === 'throw') throw new Error('stale api');
              return () => 'replacement';
            },
          };
          globalThis.__result = ${replacement?.replacement ?? 'undefined'};
        `,
        context,
      );
      expect(context.__result).toBe(originalHandler);
      expect(context.__getterReads).toBe(1);
    }
  });

  it('keeps repeated builds stable and gives distinct source occurrences distinct identities', () => {
    const source = [
      'export function Actions({ modal }) {',
      '  return <>',
      '    <button onClick={modal.open}>First</button>',
      '    <button onClick={modal.open}>Second</button>',
      '  </>;',
      '}',
    ].join('\n');

    const first = instrumentPreviewDeferredUiTriggers(SOURCE_PATH, source);
    const second = instrumentPreviewDeferredUiTriggers(SOURCE_PATH, source);
    const ids = first.registrations.map(
      (registration) => /"id":"([^"]+)"/u.exec(registration)?.[1],
    );

    expect(second).toEqual(first);
    expect(new Set(ids).size).toBe(2);
  });
});

/** Verifies stable authored offsets across deferred-trigger, condition, and effect instrumentation. */
import { describe, expect, it } from 'vitest';
import { instrumentPreviewDeferredUiTriggers } from '../../../../src/adapters/esbuild/staticResources/previewDeferredUiTriggerInstrumentation';
import { instrumentPreviewRuntimeSource } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeSourceInstrumentation';

describe('instrumentPreviewRuntimeSource', () => {
  it('captures deferred trigger identity before conditional JSX changes source offsets', () => {
    const sourcePath = '/workspace/src/ConditionalModal.tsx';
    const source = [
      'export function ConditionalModal({ visible, modal }) {',
      '  return <main>{visible && <button onClick={() => modal.show()}>Show</button>}</main>;',
      '}',
    ].join('\n');
    const authoredDeferred = instrumentPreviewDeferredUiTriggers(sourcePath, source);

    const result = instrumentPreviewRuntimeSource(sourcePath, source, {
      isolateEffects: false,
      renderConditions: true,
    });

    expect(result.registrations).toEqual(
      expect.arrayContaining([...authoredDeferred.registrations]),
    );
    expect(
      result.registrations.some((registration) =>
        registration.includes('registerRenderConditionDefinition'),
      ),
    ).toBe(true);
    expect(result.registrations[0]).toContain('"line":2');
    expect(result.registrations[0]).toContain('"invocationSafe":true');
    expect(result.source).toContain('.resolveRenderConditionLazy(');
    expect(result.source).toContain('.registerDeferredUiTrigger?.(');
    expect(result.source).toContain('() => modal.show()');
  });

  /** Adapts async JSX only after authored-offset condition and trigger analysis is complete. */
  it('composes async component isolation with ordinary inspector instrumentation', () => {
    const sourcePath = '/workspace/src/AsyncPage.tsx';
    const source = [
      'export async function ServerPanel() {',
      '  await new Promise(() => undefined);',
      '  return <section>SERVER_ONLY_BODY</section>;',
      '}',
      'export function Page({ visible, modal }) {',
      '  return <main><ServerPanel />{visible && <button onClick={() => modal.show()}>Show</button>}</main>;',
      '}',
    ].join('\n');

    const authoredDeferred = instrumentPreviewDeferredUiTriggers(sourcePath, source);
    const result = instrumentPreviewRuntimeSource(sourcePath, source, {
      isolateEffects: false,
      renderConditions: true,
    });

    expect(result.source).toContain('data-react-preview-async-component="ServerPanel"');
    expect(result.source).toContain('SERVER_ONLY_BODY');
    expect(result.source).toContain('await new Promise');
    expect(result.source).toContain('Promise.resolve().then(load)');
    expect(result.source).toContain('throw record.promise');
    expect(result.source).toContain('.resolveRenderConditionLazy(');
    expect(result.source).toContain('.registerDeferredUiTrigger?.(');
    expect(result.registrations).toEqual(
      expect.arrayContaining([...authoredDeferred.registrations]),
    );
    expect(
      result.registrations.some((registration) =>
        registration.includes('registerRenderConditionDefinition'),
      ),
    ).toBe(true);
    expect(result.registrations[0]).toContain('"line":6');
  });

  /** Keeps gallery and non-Inspector source semantics unchanged when condition tooling is disabled. */
  it('does not isolate async components outside condition-enabled Page Inspector builds', () => {
    const source = 'export async function ServerPanel(){ return <section>authored</section>; }';

    const result = instrumentPreviewRuntimeSource('/workspace/src/ServerPanel.tsx', source, {
      isolateEffects: false,
      renderConditions: false,
    });

    expect(result.source).toBe(source);
  });

  /** Avoids duplicating condition metadata across every dependency in a large authored page graph. */
  it('can instrument dependency conditions without registering unreached scenario definitions', () => {
    const source = 'export const DependencyPanel = ({ open }) => open && <Panel />;';

    const result = instrumentPreviewRuntimeSource('/workspace/src/DependencyPanel.tsx', source, {
      isolateEffects: false,
      registerConditionDefinitions: false,
      renderConditions: true,
    });

    expect(result.source).toContain('.resolveRenderConditionLazy(');
    expect(result.registrations).toEqual([]);
  });
});

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

    expect(result.registrations).toEqual(authoredDeferred.registrations);
    expect(result.registrations[0]).toContain('"line":2');
    expect(result.registrations[0]).toContain('"invocationSafe":true');
    expect(result.source).toContain('.resolveRenderConditionLazy(');
    expect(result.source).toContain('.registerDeferredUiTrigger?.(');
    expect(result.source).toContain('() => modal.show()');
  });
});

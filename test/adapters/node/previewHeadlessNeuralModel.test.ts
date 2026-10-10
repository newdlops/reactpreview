/** Verifies that a headless render restores a seeded neural model and returns the trained one. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { readPreviewHeadlessNeuralModel } from '../../../src/adapters/node/previewHeadlessNeuralModel';
import { createPreviewHeadlessBridgeSource } from '../../../src/adapters/node/previewHeadlessRenderer';
import {
  readPreviewInspectorNeuralModel,
  type PreviewInspectorNeuralModel,
} from '../../../src/presentation/previewInspectorNeuralModelProtocol';

describe('headless neural model carry', () => {
  /** Only the model is restored, and the last synchronization reaches the captured payload. */
  it('seeds webview state and captures the last synchronized model', () => {
    const seeded = requireModel({ heads: {}, version: 4 });
    const trained = requireModel({
      heads: {
        general: { evidence: 1, outputBias: 0.5, outputWeights: Array(16).fill(0.25), updates: 1 },
      },
      version: 4,
    });
    const bindingName = '__reactPreviewHeadless_neural';
    const payloads: string[] = [];
    const context: Record<string, unknown> = {
      MutationObserver: InertMutationObserver,
      [bindingName]: (payload: string) => payloads.push(payload),
      addEventListener: () => undefined,
      console: { error: () => undefined, warn: () => undefined },
      document: {
        getElementById: () => null,
        querySelector: () => ({ innerHTML: '<main></main>', querySelector: () => null }),
      },
      setTimeout: (callback: () => void) => {
        callback();
        return 0;
      },
    };
    vm.runInNewContext(
      `${createPreviewHeadlessBridgeSource('1:test', 1, bindingName, false, seeded)}
globalThis.__api = globalThis.acquireVsCodeApi();`,
      context,
    );
    const api = context.__api as {
      getState(): unknown;
      postMessage(message: unknown): Promise<boolean>;
    };

    const restored = api.getState();
    void api.postMessage({
      model: trained,
      runtimeRevision: 1,
      type: 'react-preview-neural-model-sync',
    });
    void api.postMessage({ revision: 1, token: '1:test', type: 'react-preview-runtime-ready' });

    expect(restored).toEqual({ reactFilePreviewPageInspector: { neuralResidualModel: seeded } });
    expect(payloads).toHaveLength(1);
    const captured = (JSON.parse(payloads[0] ?? '{}') as { neuralResidualModel?: unknown })
      .neuralResidualModel;
    expect(readPreviewHeadlessNeuralModel(captured)).toEqual(trained);
  });

  /** Captured values pass the same validation as webview synchronization traffic. */
  it('rejects malformed captured models', () => {
    expect(readPreviewHeadlessNeuralModel(undefined)).toBeUndefined();
    expect(
      readPreviewHeadlessNeuralModel({ heads: { general: { outputWeights: [] } }, version: 4 }),
    ).toBeUndefined();
  });
});

/** Minimal observer the bridge installs on the mount node. */
class InertMutationObserver {
  /** Accepts observation requests without recording mutations. */
  public observe(): undefined {
    return undefined;
  }
}

/** Narrows a fixture through the production parser. */
function requireModel(value: unknown): PreviewInspectorNeuralModel {
  const model = readPreviewInspectorNeuralModel(value);
  if (model === undefined) throw new Error('Invalid neural model fixture.');
  return model;
}

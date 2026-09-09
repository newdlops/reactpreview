/** Verifies bounded neural hook recommendations in the shared isolated fallback runtime. */
import { describe, expect, it } from 'vitest';
import {
  createMetadata,
  createRuntimeFallbackFixture,
} from './support/previewInspectorRuntimeFallbackFixture';

describe('Preview Inspector runtime fallback NeuralRecommendations', () => {
  /**
   * Repairs the scalar provenance gap created when one generated hook is returned by another hook.
   * The first pass supplies a neutral typed shape; the existing Smart retry opens the learned branch.
   */
  it('uses a neural typed recommendation for a nested generated primitive', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const innerMetadata = {
      ...createMetadata(),
      fallbackLabel: 'generated scalar to continue past an early return',
      hookName: 'useContext',
      id: 'inner-context-hook',
      ownerName: 'usePanel',
      requiredPaths: ['<root>'],
    };
    const outerMetadata = {
      ...createMetadata(),
      fallbackLabel: 'generated object fields',
      hookName: 'usePanel',
      id: 'outer-panel-hook',
      ownerName: 'PanelFrame',
      requiredPaths: ['state.status'],
      smartPathValues: [{ path: 'state.status', value: 'open' }],
    };
    const readPanel = (): unknown =>
      fixture.api.resolve(
        () => undefined,
        () => 'ctx',
        innerMetadata,
      );
    const usePanelIdentity = (): undefined => undefined;
    const panelContextIdentity = {};
    expect(fixture.api.registerContext(usePanelIdentity, panelContextIdentity)).toBe(true);

    expect(
      fixture.api.resolve(
        readPanel,
        () => ({ state: { status: 'PREVIEW' } }),
        outerMetadata,
        undefined,
        undefined,
        () => usePanelIdentity,
      ),
    ).toEqual({ state: { status: 'PREVIEW' } });
    expect(fixture.api.read().find((record) => record.id === 'outer-panel-hook')).toMatchObject({
      mode: 'auto',
      neuralRecommendation: {
        residual: { score: 0.5 },
        strategy: 'branch-opening',
        value: { state: { status: 'open' } },
      },
      reason: 'neural-candidate',
      requiredPaths: ['state.status'],
    });

    fixture.api.smart('outer-panel-hook');
    expect(fixture.neuralResumeCount()).toBe(0);
    fixture.flushEffectFrame();
    expect(fixture.neuralResumeCount()).toBe(1);
    expect(fixture.neuralRetryCount()).toBe(1);
    const authoredClose = (): string => 'authored-close';
    const providerValue = {
      close: authoredClose,
      currentWidth: 480,
      state: { status: 'closed' },
    };
    const providerConsumer = fixture.api.resolve(
      () => providerValue,
      () => ({ close: () => undefined, currentWidth: 520, state: { status: 'loading' } }),
      {
        ...innerMetadata,
        id: 'provider-context-read',
        ownerName: 'usePanel',
        requiredPaths: ['state.status', 'currentWidth', 'close()'],
      },
      undefined,
      undefined,
      () => panelContextIdentity,
    ) as { close: () => string; currentWidth: number; state: { status: string } };
    expect(providerConsumer).not.toBe(providerValue);
    expect(providerConsumer.state.status).toBe('open');
    expect(providerConsumer.currentWidth).toBe(480);
    expect(providerConsumer.close).toBe(authoredClose);
    expect(providerValue.state.status).toBe('closed');

    const resolved = fixture.api.resolve(
      readPanel,
      () => ({ state: { status: 'ignored-after-cache' } }),
      outerMetadata,
      undefined,
      undefined,
      () => usePanelIdentity,
    ) as { state: { status: string } };

    expect(resolved.state.status).toBe('open');
    expect(fixture.api.read().find((record) => record.id === 'outer-panel-hook')).toMatchObject({
      generatedPaths: ['state.status'],
      mode: 'smart',
      reason: 'partial',
    });

    const sibling = fixture.api.resolve(
      readPanel,
      () => ({
        registration: { buttonBoundPathname: '/preview/chat' },
        state: { status: 'SIBLING' },
      }),
      {
        ...outerMetadata,
        id: 'sibling-panel-hook',
        ownerName: 'PanelButton',
        requiredPaths: ['registration.buttonBoundPathname', 'state.status'],
      },
      undefined,
      undefined,
      () => usePanelIdentity,
    ) as { registration: { buttonBoundPathname: string }; state: { status: string } };
    expect(sibling.state.status).toBe('open');
    expect(sibling.registration.buttonBoundPathname).toBe('/preview/chat');
    expect(fixture.api.read().some((record) => record.id === 'sibling-panel-hook')).toBe(false);
  });

  /** A learned state reaches mounted consumers even while its boundary reset waits for DFS. */
  it('notifies neural subscribers while an active target attempt defers export retry', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const innerMetadata = {
      ...createMetadata(),
      hookName: 'useContext',
      id: 'inner-context-hook',
      ownerName: 'usePanel',
      requiredPaths: ['<root>'],
    };
    const outerMetadata = {
      ...createMetadata(),
      hookName: 'usePanel',
      id: 'outer-panel-hook',
      requiredPaths: ['state.status'],
      smartPathValues: [{ path: 'state.status', value: 'open' }],
    };
    const hookIdentity = (): undefined => undefined;
    const readPanel = (): unknown =>
      fixture.api.resolve(
        () => undefined,
        () => 'ctx',
        innerMetadata,
      );
    let notifications = 0;
    fixture.api.subscribeNeural(() => {
      notifications += 1;
    });
    fixture.api.resolve(
      readPanel,
      () => ({ state: { status: 'PREVIEW' } }),
      outerMetadata,
      undefined,
      undefined,
      () => hookIdentity,
    );
    fixture.api.setActiveNeuralAttempt(true);
    fixture.api.smart('outer-panel-hook');
    fixture.flushEffectFrame();

    expect(notifications).toBe(1);
    expect(fixture.neuralResumeCount()).toBe(0);
    expect(fixture.neuralRetryCount()).toBe(0);
  });

  /** Projects one selected state through the memoized Context object used by its page shell. */
  it('shares a target Smart discriminator with sibling consumers of the same hook identity', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const authoredClose = (): undefined => undefined;
    const authored = {
      close: authoredClose,
      currentWidth: 600,
      state: { status: 'closed' },
    };
    const targetMetadata = {
      ...createMetadata(),
      hookName: 'usePanel',
      id: 'target-panel-hook',
      ownerName: 'Panel',
      requiredPaths: ['state.status', 'currentWidth', 'close()'],
      smartPathValues: [{ path: 'state.status', value: 'loading' }],
      sourcePath: '/workspace/Panel.tsx',
    };
    const shellMetadata = {
      ...createMetadata(),
      hookName: 'usePanel',
      id: 'page-shell-hook',
      ownerName: 'PageShell',
      requiredPaths: ['state'],
      sourcePath: '/workspace/PageShell.tsx',
    };

    expect(
      fixture.api.resolve(
        () => authored,
        () => ({ close: () => undefined, currentWidth: 0, state: { status: 'PREVIEW' } }),
        targetMetadata,
      ),
    ).toBe(authored);
    expect(fixture.api.read()).toHaveLength(1);

    fixture.api.smart('target-panel-hook');
    const shellValue = fixture.api.resolve(
      () => authored,
      () => ({ state: {} }),
      shellMetadata,
    ) as typeof authored;
    const targetValue = fixture.api.resolve(
      () => authored,
      () => ({ close: () => undefined, currentWidth: 0, state: { status: 'PREVIEW' } }),
      targetMetadata,
    ) as typeof authored;

    expect(shellValue.state.status).toBe('loading');
    expect(targetValue.state.status).toBe('loading');
    expect(shellValue.close).toBe(authoredClose);
    expect(authored.state.status).toBe('closed');
    expect(fixture.api.read().map((record) => record.id)).toEqual(['target-panel-hook']);
  });

  /** Selects one authored state candidate instead of collapsing the path to its first literal. */
  it('uses the render-state neural head to choose a coherent Smart discriminator', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const authored = { state: { status: 'closed' } };
    const metadata = {
      ...createMetadata(),
      hookName: 'usePanel',
      id: 'render-state-panel-hook',
      ownerName: 'Panel',
      requiredPaths: ['state.status'],
      smartPathValues: [
        {
          deterministicRank: 0,
          path: 'state.status',
          role: 'render-state',
          value: 'open',
        },
        {
          deterministicRank: 1,
          path: 'state.status',
          role: 'render-state',
          value: 'loading',
        },
      ],
    };

    expect(
      fixture.api.resolve(
        () => authored,
        () => ({ state: { status: 'PREVIEW' } }),
        metadata,
      ),
    ).toBe(authored);
    fixture.api.smart(metadata.id);
    const resolved = fixture.api.resolve(
      () => authored,
      () => ({ state: { status: 'PREVIEW' } }),
      metadata,
    ) as { state: { status: string } };

    expect(resolved.state.status).toBe('open');
    expect(fixture.api.neuralModel().heads['render-state']).toBeUndefined();
  });

  /** Uses the exact hook function as a carrier only when a missing Provider makes both calls fail. */
  it('shares target Smart state across Provider-less calls of the same hook function', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const usePanel = (): never => {
      throw new Error('usePanel must be used within PanelProvider');
    };
    const targetMetadata = {
      ...createMetadata(),
      hookName: 'usePanel',
      id: 'providerless-target-panel-hook',
      ownerName: 'Panel',
      requiredPaths: ['state.status', 'currentWidth'],
      smartPathValues: [
        { path: 'state.status', value: 'loading' },
        { path: 'currentWidth', value: 420 },
      ],
      sourcePath: '/workspace/Panel.tsx',
    };
    const shellMetadata = {
      ...createMetadata(),
      hookName: 'usePanel',
      id: 'providerless-page-shell-hook',
      ownerName: 'PageShell',
      requiredPaths: ['state.status'],
      sourcePath: '/workspace/PageShell.tsx',
    };

    fixture.api.resolve(
      usePanel,
      () => ({ currentWidth: 0, state: { status: 'PREVIEW' } }),
      targetMetadata,
      undefined,
      undefined,
      () => usePanel,
    );
    fixture.api.smart('providerless-target-panel-hook');

    const shellValue = fixture.api.resolve(
      usePanel,
      () => ({ state: { status: 'PREVIEW' } }),
      shellMetadata,
      undefined,
      undefined,
      () => usePanel,
    ) as { state: { status: string } };
    const targetValue = fixture.api.resolve(
      usePanel,
      () => ({ currentWidth: 0, state: { status: 'PREVIEW' } }),
      targetMetadata,
      undefined,
      undefined,
      () => usePanel,
    ) as { currentWidth: number; state: { status: string } };

    expect(shellValue.state.status).toBe('loading');
    expect(targetValue).toMatchObject({ currentWidth: 420, state: { status: 'loading' } });
    expect(fixture.api.read().map((record) => record.id)).toEqual([
      'providerless-target-panel-hook',
    ]);
  });

  /** Compiler proof admits a candidate, but cannot invent positive and negative render labels. */
  it('proposes a compiler-proven identity reference without self-training or retry loops', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      hookName: 'useProjectField',
      requiredPaths: ['value'],
      semanticValueDemand: { kind: 'identity', path: 'value' },
    };
    const readHook = (): object => {
      throw new Error('generated field provider unavailable');
    };
    const createFallback = (): object => ({ value: 'value' });

    const discovery = fixture.api.resolve(readHook, createFallback, metadata) as { value: string };

    expect(discovery.value).toBe('preview-id');
    expect(fixture.api.neuralModel().updates).toBe(0);

    fixture.flushEffectFrame();

    expect(fixture.api.neuralModel().updates).toBe(0);

    const retried = fixture.api.resolve(readHook, createFallback, metadata) as { value: string };
    expect(retried.value).toBe('preview-id');
    expect(fixture.api.read()[0]).toMatchObject({
      mode: 'auto',
      neuralRecommendation: {
        candidateId: 'generated-identity-reference',
        strategy: 'generated-identity-reference',
      },
      reason: 'threw',
    });
    expect(fixture.autoDecisions.at(-1)).toMatchObject({
      startsRenderAttempt: true,
      targetReachabilityKey: 'page:Target',
    });

    fixture.flushEffectFrame();
    expect(fixture.neuralRetryCount()).toBe(0);
    expect(fixture.api.neuralModel().updates).toBe(0);
  });

  /** A complete application-owned identity is evidence, not a hole the generated model may replace. */
  it('does not train or overwrite a successful authored identity field', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      requiredPaths: ['value'],
      semanticValueDemand: { kind: 'identity', path: 'value' },
    };
    const authored = { value: 'company-director-42' };

    expect(
      fixture.api.resolve(
        () => authored,
        () => ({ value: 'value' }),
        metadata,
      ),
    ).toBe(authored);
    fixture.flushEffectFrame();

    expect(fixture.api.neuralModel().updates).toBe(0);
    expect(fixture.neuralRetryCount()).toBe(0);
  });
});

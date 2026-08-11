import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorLocalUiControllerRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorLocalUiControllerRuntimeSource';

interface LocalUiRuntimeApi {
  auto(state: object): unknown;
  remember(metadata: object, value: object): unknown;
}

function createFixture(targetProps: object) {
  const decisions: object[] = [];
  const boundary = {
    props: {
      children: { props: targetProps },
      exportName: 'FundPartnersInviteModalForm',
      sourcePath: '/vcm/FundPartnersInviteModalForm.tsx',
    },
  };
  const sandbox = {
    blockedInspectorPropNames: new Set(['__proto__', 'constructor', 'prototype']),
    isPreviewInspectorRuntimeThenable(): boolean { return false; },
    previewEntryRevision: 0,
    previewInspectorSession: {
      activeTargetReachabilityKey: 'route:fund',
      boundariesByExport: new Map([['FundPartnersInviteModalForm', new Set([boundary])]]),
      fallbackValuesEnabled: true,
    },
    recordPreviewInspectorBlockerAutoDecision(decision: object): void { decisions.push(decision); },
    recordPreviewInspectorRuntimeEffectIsolation(): void { return undefined; },
  };
  const context = createContext(sandbox);
  runInContext(
    `${createPreviewInspectorLocalUiControllerRuntimeSource()}\n` +
      'globalThis.__api = { auto: autoActivatePreviewInspectorTargetLocalUiController, remember: rememberPreviewInspectorLocalUiController };',
    context,
  );
  return {
    api: (sandbox as typeof sandbox & { __api: LocalUiRuntimeApi }).__api,
    decisions,
  };
}

function state(): object {
  return {
    applicationPath: ['VcmGpFundPage', 'FundPartnerInvitePanel', 'FundPartnersInviteModalForm'],
    key: 'route:fund',
    targetExportName: 'FundPartnersInviteModalForm',
    targetHasOutput: false,
    targetMounted: true,
    targetSourcePath: '/vcm/FundPartnersInviteModalForm.tsx',
  };
}

function metadata(id: string): object {
  return {
    id,
    ownerName: 'FundPartnerInvitePanel',
    sourcePath: '/vcm/FundPartnerInvitePanel.tsx',
  };
}

describe('Preview Inspector local UI controller runtime source', () => {
  it('activates one caller-owned VCM modal controller through its exact target props once', () => {
    let calls = 0;
    const modalProps = { onClose() {}, show: false };
    const fixture = createFixture({ nested: { modalProps } });
    fixture.api.remember(metadata('invite'), [modalProps, { hide() {}, show() { calls += 1; } }]);

    expect(fixture.api.auto(state())).toMatchObject({ id: 'invite' });
    expect(fixture.api.auto(state())).toBeUndefined();
    expect(calls).toBe(1);
    expect(fixture.decisions).toHaveLength(1);
  });

  it('fails closed for unrelated, accessor-only, and ambiguous caller evidence', () => {
    let calls = 0;
    const modalProps = { onClose() {}, show: false };
    const unrelated = createFixture({ modalProps: { onClose() {}, show: false } });
    unrelated.api.remember(metadata('unrelated'), [modalProps, { show() { calls += 1; } }]);
    expect(unrelated.api.auto(state())).toBeUndefined();

    const accessorProps = {};
    Object.defineProperty(accessorProps, 'modalProps', { enumerable: true, get() { throw new Error('no accessor'); } });
    const accessor = createFixture(accessorProps);
    accessor.api.remember(metadata('accessor'), [modalProps, { show() { calls += 1; } }]);
    expect(accessor.api.auto(state())).toBeUndefined();

    const secondModalProps = { onClose() {}, show: false };
    const multiple = createFixture({ first: modalProps, second: secondModalProps });
    multiple.api.remember(metadata('first'), [modalProps, { show() { calls += 1; } }]);
    multiple.api.remember(metadata('second'), [secondModalProps, { show() { calls += 1; } }]);
    expect(multiple.api.auto(state())).toBeUndefined();
    expect(calls).toBe(0);
  });
});

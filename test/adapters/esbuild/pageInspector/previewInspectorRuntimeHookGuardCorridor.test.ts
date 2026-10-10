/**
 * Verifies that a hook guard pass (a boolean forced past an early return) applies only on the
 * selected root-to-target corridor, so shell-mounted sibling popups keep their authored state.
 */
import { describe, expect, it } from 'vitest';
import {
  createMetadata,
  createRuntimeFallbackFixture,
  type RuntimeFallbackFixture,
} from './support/previewInspectorRuntimeFallbackFixture';

/** Installs one reachability state and corridor evidence for the page → target path. */
function installCorridor(fixture: RuntimeFallbackFixture): void {
  fixture.evaluate(`
    previewInspectorSession.targetReachabilityByKey = new Map([
      ['page:Target', { rootName: 'Page', targetExportName: 'Target' }],
    ]);
    globalThis.normalizePreviewInspectorReachabilityPath = (value) =>
      typeof value === 'string' ? value : '';
    globalThis.findSelectedPreviewInspectorDescriptor = () => ({
      inspector: { target: { exportName: 'Target', sourcePath: '/workspace/Target.tsx' } },
    });
    globalThis.readSelectedPreviewInspectorPageCandidate = () => ({
      target: { exportName: 'Target', sourcePath: '/workspace/Target.tsx' },
    });
    globalThis.readPreviewInspectorTargetPathEvidence = () => ({
      corridorOwnerNames: new Set(['Page']),
      localComponentOwnerNames: new Set(),
      names: new Set(['Page', 'Target']),
      paths: new Set(['/workspace/Page.tsx', '/workspace/Target.tsx']),
    });
  `);
}

/** A boolean store hook whose value must pass 'if (!isOpen) return null' to render. */
function guardMetadata(sourcePath: string, ownerName: string): object {
  return {
    ...createMetadata(),
    hookName: 'useAtomValue',
    id: `guard:${ownerName}`,
    moduleSpecifier: 'jotai',
    ownerName,
    renderGuardPaths: ['<root>'],
    requiredPaths: ['<root>'],
    sourcePath,
  };
}

describe('runtime hook guard pass corridor', () => {
  /** A popup the application shell mounts beside the page keeps its closed state. */
  it('keeps an off-corridor sibling guard as authored', () => {
    const fixture = createRuntimeFallbackFixture(true);
    installCorridor(fixture);

    const popup = fixture.api.resolve(
      () => false,
      () => true,
      guardMetadata('/workspace/GlobalPopUp.tsx', 'RetryRidePopUp'),
    );
    // Same corridor file, but a sibling dialog that is not a proven corridor component.
    const sibling = fixture.api.resolve(
      () => false,
      () => true,
      guardMetadata('/workspace/Page.tsx', 'UnrelatedDialog'),
    );

    expect(popup).toBe(false);
    expect(sibling).toBe(false);
  });

  /** A store bridge placeholder is not page state, so the guard still replaces it off-corridor. */
  it('still replaces a callable placeholder off the corridor', () => {
    const fixture = createRuntimeFallbackFixture(true);
    installCorridor(fixture);

    // 'if (isIndividualBusiness) return null' with an inert callable served for an unread path.
    const resolved = fixture.api.resolve(
      () => () => undefined,
      () => false,
      guardMetadata('/workspace/CorporationInfoSection.tsx', 'CorporationInfoSection'),
    );

    expect(resolved).toBe(false);
  });

  /** The target and its corridor owners still pass their guards to reach the target. */
  it('passes guards owned by the target module and corridor components', () => {
    const fixture = createRuntimeFallbackFixture(true);
    installCorridor(fixture);

    expect(
      fixture.api.resolve(
        () => false,
        () => true,
        guardMetadata('/workspace/Page.tsx', 'Page'),
      ),
    ).toBe(true);
    expect(
      fixture.api.resolve(
        () => false,
        () => true,
        guardMetadata('/workspace/Target.tsx', 'TargetPanel'),
      ),
    ).toBe(true);
  });

  /** A toast host the App mounts on every page keeps its store's empty list off the corridor. */
  it('keeps an off-corridor same-module store authored and fills it for the target', () => {
    const fixture = createRuntimeFallbackFixture(true);
    installCorridor(fixture);
    const storeMetadata = (sourcePath: string, ownerName: string): object => ({
      ...createMetadata(),
      hookName: 'useToastStore',
      id: `store:${ownerName}`,
      moduleSpecifier: 'local-store',
      ownerName,
      requiredPaths: ['[].text'],
      sourcePath,
    });
    const sample = (): readonly { text: string }[] => [{ text: 'text' }];

    const offCorridor = fixture.api.resolve(
      () => [],
      sample,
      storeMetadata('/workspace/Toast.tsx', 'ToastHost'),
    );
    const target = fixture.api.resolve(
      () => [],
      sample,
      storeMetadata('/workspace/Target.tsx', 'ToastHost'),
    );

    expect(offCorridor).toEqual([]);
    expect(target).toEqual([{ text: 'text' }]);
  });

  /** Without reachability evidence the guard pass behaves exactly as before. */
  it('keeps the authored guard pass when no corridor evidence exists', () => {
    const fixture = createRuntimeFallbackFixture(true);

    expect(
      fixture.api.resolve(
        () => false,
        () => true,
        guardMetadata('/workspace/GlobalPopUp.tsx', 'RetryRidePopUp'),
      ),
    ).toBe(true);
  });
});

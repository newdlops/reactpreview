import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorDomOwnershipRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorDomOwnershipRuntimeSource';

describe('Preview Inspector DOM ownership runtime source', () => {
  it('discovers a JSX context initialized before the Inspector API and refuses conflicting capability metadata', () => {
    const contextValue = {};
    const sandbox: Record<PropertyKey, unknown> = {
      Symbol,
      WeakMap,
      Set,
      globalThis: undefined,
    };
    sandbox.globalThis = sandbox;
    sandbox[Symbol.for('newdlops.react-file-preview.page-inspector.jsx-ownership-context')] =
      contextValue;
    vm.runInNewContext(
      createPreviewInspectorDomOwnershipRuntimeSource() +
        '\n' +
        'globalThis.__ownership = { createPreviewInspectorOwnershipToken, readPreviewInspectorJsxOwnershipContext, registerPreviewInspectorCompilerCapability };',
      sandbox,
    );
    const ownership = sandbox.__ownership as {
      readonly createPreviewInspectorOwnershipToken: (
        marker: object,
        metadata: object,
      ) => object | undefined;
      readonly readPreviewInspectorJsxOwnershipContext: () => unknown;
      readonly registerPreviewInspectorCompilerCapability: (
        marker: object,
        metadata: object,
      ) => boolean;
    };
    const marker = {};
    const metadata = { exportName: 'Target', sourcePath: '/workspace/Target.tsx' };
    expect(ownership.readPreviewInspectorJsxOwnershipContext()).toBe(contextValue);
    expect(ownership.registerPreviewInspectorCompilerCapability(marker, metadata)).toBe(true);
    expect(ownership.registerPreviewInspectorCompilerCapability(marker, metadata)).toBe(true);
    expect(
      ownership.registerPreviewInspectorCompilerCapability(marker, {
        ...metadata,
        exportName: 'Other',
      }),
    ).toBe(false);
    expect(ownership.createPreviewInspectorOwnershipToken(marker, metadata)).toBeDefined();
    expect(
      ownership.createPreviewInspectorOwnershipToken(marker, { ...metadata, exportName: 'Other' }),
    ).toBeUndefined();
  });

  it('invalidates the tree when authenticated target-host ownership attaches or detaches', () => {
    let refreshCount = 0;
    const metadata = { exportName: 'Target', sourcePath: '/workspace/Target.tsx' };
    const sandbox: Record<PropertyKey, unknown> = {
      Set,
      Symbol,
      WeakMap,
      findSelectedPreviewInspectorDescriptor: () => ({
        inspector: { target: metadata },
      }),
      globalThis: undefined,
      schedulePreviewInspectorCommitRefresh: () => {
        refreshCount += 1;
      },
    };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(
      createPreviewInspectorDomOwnershipRuntimeSource() +
        '\n' +
        `globalThis.__ownership = {
          createPreviewInspectorOwnershipToken,
          hasPreviewInspectorOwnedBoundary,
          readPreviewInspectorOwnedHosts,
          registerPreviewInspectorCompilerCapability,
          registerPreviewInspectorOwnedHost,
          registerPreviewInspectorOwnershipBoundary,
        };`,
      sandbox,
    );
    const ownership = sandbox.__ownership as {
      readonly createPreviewInspectorOwnershipToken: (
        marker: object,
        metadata: object,
      ) => object | undefined;
      readonly hasPreviewInspectorOwnedBoundary: (boundary: object, state: object) => boolean;
      readonly readPreviewInspectorOwnedHosts: (
        boundary: object,
        state: object,
      ) => readonly object[];
      readonly registerPreviewInspectorCompilerCapability: (
        marker: object,
        metadata: object,
      ) => boolean;
      readonly registerPreviewInspectorOwnedHost: (
        token: object,
        node: object,
      ) => (() => void) | undefined;
      readonly registerPreviewInspectorOwnershipBoundary: (
        token: object,
        boundary: object,
      ) => (() => void) | undefined;
    };
    const marker = {};
    expect(ownership.registerPreviewInspectorCompilerCapability(marker, metadata)).toBe(true);
    const token = ownership.createPreviewInspectorOwnershipToken(marker, metadata);
    expect(token).toBeDefined();
    const boundary = { ownershipToken: token };
    const unregisterBoundary = ownership.registerPreviewInspectorOwnershipBoundary(
      token ?? {},
      boundary,
    );
    expect(unregisterBoundary).toBeDefined();
    expect(
      ownership.hasPreviewInspectorOwnedBoundary(boundary, {
        targetExportName: 'Target',
      }),
    ).toBe(true);
    expect(
      ownership.hasPreviewInspectorOwnedBoundary(boundary, {
        targetExportName: 'Other',
      }),
    ).toBe(false);

    const host = { nodeType: 1 };
    const releaseHost = ownership.registerPreviewInspectorOwnedHost(token ?? {}, host);
    expect(releaseHost).toBeDefined();
    expect(refreshCount).toBe(1);
    expect(
      ownership.readPreviewInspectorOwnedHosts(boundary, {
        targetExportName: 'Target',
      }),
    ).toEqual([host]);

    releaseHost?.();
    expect(refreshCount).toBe(2);
    expect(
      ownership.readPreviewInspectorOwnedHosts(boundary, {
        targetExportName: 'Target',
      }),
    ).toEqual([]);
    releaseHost?.();
    expect(refreshCount).toBe(2);
  });

  it('uses the selected route target source rather than the outer inspected document', () => {
    const outerTarget = { exportName: 'App', sourcePath: '/workspace/App.tsx' };
    const routeTarget = { exportName: 'RoutePage', sourcePath: '/workspace/routes/RoutePage.tsx' };
    const sandbox: Record<PropertyKey, unknown> = {
      Set,
      Symbol,
      WeakMap,
      findSelectedPreviewInspectorDescriptor: () => ({ inspector: { target: outerTarget } }),
      globalThis: undefined,
    };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(
      createPreviewInspectorDomOwnershipRuntimeSource() +
        '\n' +
        `globalThis.__ownership = {
          createPreviewInspectorOwnershipToken,
          readPreviewInspectorOwnedHosts,
          registerPreviewInspectorCompilerCapability,
          registerPreviewInspectorOwnedHost,
          registerPreviewInspectorOwnershipBoundary,
        };`,
      sandbox,
    );
    const ownership = sandbox.__ownership as {
      readonly createPreviewInspectorOwnershipToken: (
        marker: object,
        metadata: object,
      ) => object | undefined;
      readonly readPreviewInspectorOwnedHosts: (
        boundary: object,
        state: object,
      ) => readonly object[];
      readonly registerPreviewInspectorCompilerCapability: (
        marker: object,
        metadata: object,
      ) => boolean;
      readonly registerPreviewInspectorOwnedHost: (token: object, node: object) => unknown;
      readonly registerPreviewInspectorOwnershipBoundary: (token: object, boundary: object) => unknown;
    };
    const marker = {};
    expect(ownership.registerPreviewInspectorCompilerCapability(marker, routeTarget)).toBe(true);
    const token = ownership.createPreviewInspectorOwnershipToken(marker, routeTarget);
    const boundary = { ownershipToken: token };
    ownership.registerPreviewInspectorOwnershipBoundary(token ?? {}, boundary);
    const host = { nodeType: 1 };
    ownership.registerPreviewInspectorOwnedHost(token ?? {}, host);

    expect(
      ownership.readPreviewInspectorOwnedHosts(boundary, {
        targetExportName: 'RoutePage',
        targetSourcePath: routeTarget.sourcePath,
      }),
    ).toEqual([host]);
  });
});

/** Verifies canonical campaign artifacts reject every material form of stale planner identity. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PreviewRouteExecutionPlanArtifact } from '../../../src/domain/preview';
import { PreviewRouteExecutionPlanInvariantError } from '../../../src/domain/preview';
import {
  assertPreviewRouteExecutionPlanArtifact,
  stablePreviewRouteExecutionPlanJson,
} from '../../../src/adapters/esbuild/previewRouteExecutionPlan';
import { createPreviewRouteExecutionPlanFixture } from '../../support/previewRouteExecutionPlanFixture';

const BASE_ARTIFACT = createPreviewRouteExecutionPlanFixture({
  componentName: 'Leaf',
  pathname: '/parent/alternate/item-1',
  pattern: '/parent/alternate/:itemId',
  routeId: 'route:alternate',
  selection: [
    { componentName: 'Nested', pattern: '/parent/*' },
    { componentName: 'Leaf', pattern: 'alternate/:itemId' },
  ],
  sourcePath: '/workspace/src/Leaf.tsx',
});

describe('previewRouteExecutionPlan', () => {
  it('accepts a byte-equivalent independently materialized artifact', () => {
    const observed = JSON.parse(
      stablePreviewRouteExecutionPlanJson(BASE_ARTIFACT),
    ) as PreviewRouteExecutionPlanArtifact;

    expect(() => {
      assertPreviewRouteExecutionPlanArtifact(BASE_ARTIFACT, observed, 'exact');
    }).not.toThrow();
  });

  it.each([
    [
      'selection[1].componentName',
      {
        ...BASE_ARTIFACT,
        selection: [
          BASE_ARTIFACT.selection[0],
          { ...BASE_ARTIFACT.selection[1], componentName: 'OtherLeaf' },
        ],
      },
    ],
    [
      'selectedBranch.pathname',
      {
        ...BASE_ARTIFACT,
        selectedBranch: { ...BASE_ARTIFACT.selectedBranch, pathname: '/different' },
      },
    ],
    [
      'planningContext.sourceSnapshotDigest',
      {
        ...BASE_ARTIFACT,
        planningContext: {
          ...BASE_ARTIFACT.planningContext,
          sourceSnapshotDigest: '1'.repeat(64),
        },
      },
    ],
    [
      'executionCandidateId',
      { ...BASE_ARTIFACT, executionCandidateId: 'execution:other' },
    ],
    [
      'executionRoot.sourcePath',
      {
        ...BASE_ARTIFACT,
        executionRoot: { ...BASE_ARTIFACT.executionRoot, sourcePath: '/workspace/src/Other.tsx' },
      },
    ],
    [
      'runtimeTarget.sourcePath',
      {
        ...BASE_ARTIFACT,
        runtimeTarget: { ...BASE_ARTIFACT.runtimeTarget, sourcePath: '/workspace/src/Other.tsx' },
      },
    ],
    [
      'rootRoleContract.preparedSourceDigest',
      {
        ...BASE_ARTIFACT,
        rootRoleContract: {
          ...BASE_ARTIFACT.rootRoleContract,
          preparedSourceDigest: '2'.repeat(64),
        },
      },
    ],
    [
      'targetRoleContract.preparedSourceDigest',
      {
        ...BASE_ARTIFACT,
        targetRoleContract: {
          ...BASE_ARTIFACT.targetRoleContract,
          preparedSourceDigest: '3'.repeat(64),
        },
      },
    ],
    [
      'frontierIdentity',
      { ...BASE_ARTIFACT, frontierIdentity: '4'.repeat(64) },
    ],
  ])('rejects current-plan drift at %s', (field, observed) => {
    expectInvariantField(
      () => {
        assertPreviewRouteExecutionPlanArtifact(
          BASE_ARTIFACT,
          observed as PreviewRouteExecutionPlanArtifact,
          'exact',
        );
      },
      field,
    );
  });

  it('rejects route-recipe drift', () => {
    const expected = sealArtifact({
      ...BASE_ARTIFACT,
      recipe: {
        kind: 'react-router',
        mounts: [
          {
            basePath: '/parent',
            childSurfaceId: 'surface:leaf',
            hasWildcardFallback: false,
            parentSurfaceId: 'surface:app',
            pattern: 'alternate/:itemId',
          },
        ],
        params: { itemId: 'item-1' },
        pathname: '/parent/alternate/item-1',
        pattern: '/parent/alternate/:itemId',
        rootOwnsRouter: true,
        routerModuleSpecifier: 'react-router-dom',
        searchParams: {},
      },
    });
    const expectedRecipe = expected.recipe;
    expect(expectedRecipe).toBeDefined();
    if (expectedRecipe === undefined) throw new Error('Expected a sealed route recipe.');
    const observed: PreviewRouteExecutionPlanArtifact = {
      ...expected,
      recipe: { ...expectedRecipe, pathname: '/parent/alternate/item-2' },
    };

    expectInvariantField(
      () => {
        assertPreviewRouteExecutionPlanArtifact(expected, observed, 'exact');
      },
      'recipe.pathname',
    );
  });

  it.each([
    [
      'digest',
      { ...BASE_ARTIFACT, digest: '0'.repeat(64) },
      'the frozen artifact payload digest is invalid',
    ],
    [
      'policyDigest',
      { ...BASE_ARTIFACT, policyDigest: '0'.repeat(64) },
      'the frozen artifact policy is stale or unsupported',
    ],
    [
      'version',
      { ...BASE_ARTIFACT, version: BASE_ARTIFACT.version + 1 },
      'the frozen artifact version is stale or unsupported',
    ],
  ])('rejects a stale or tampered frozen %s', (field, expected, reason) => {
    try {
      assertPreviewRouteExecutionPlanArtifact(
        expected,
        BASE_ARTIFACT,
        'exact',
      );
      throw new Error('Expected invariant validation to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(PreviewRouteExecutionPlanInvariantError);
      const invariant = error as PreviewRouteExecutionPlanInvariantError;
      expect(invariant.evidence).toMatchObject({ mismatchField: field, reason });
    }
  });

  it('rejects fallback resolution even when all serialized fields agree', () => {
    expectInvariantField(
      () => {
        assertPreviewRouteExecutionPlanArtifact(BASE_ARTIFACT, BASE_ARTIFACT, 'fallback');
      },
      'routeSelectionResolution',
    );
  });

  it('bounds evidence copied from an invalid artifact', () => {
    const invalid = {
      ...BASE_ARTIFACT,
      digest: '0'.repeat(64),
      routeId: 'r'.repeat(8_000),
    } as PreviewRouteExecutionPlanArtifact;

    try {
      assertPreviewRouteExecutionPlanArtifact(invalid, BASE_ARTIFACT, 'exact');
      throw new Error('Expected invariant validation to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(PreviewRouteExecutionPlanInvariantError);
      expect((error as PreviewRouteExecutionPlanInvariantError).evidence.routeId.length).toBe(4_096);
    }
  });
});

/** Recomputes the fixture self-digest after adding a recipe. */
function sealArtifact(artifact: PreviewRouteExecutionPlanArtifact): PreviewRouteExecutionPlanArtifact {
  const payload = Object.fromEntries(
    Object.entries(artifact).filter(([key]) => key !== 'digest'),
  ) as Omit<PreviewRouteExecutionPlanArtifact, 'digest'>;
  return {
    ...payload,
    digest: createHash('sha256')
      .update(stablePreviewRouteExecutionPlanJson(payload))
      .digest('hex'),
  };
}

/** Asserts one deterministic structured mismatch field. */
function expectInvariantField(action: () => void, mismatchField: string): void {
  try {
    action();
    throw new Error('Expected invariant validation to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(PreviewRouteExecutionPlanInvariantError);
    expect((error as PreviewRouteExecutionPlanInvariantError).evidence.mismatchField).toBe(
      mismatchField,
    );
  }
}

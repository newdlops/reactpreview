import { createHash } from 'node:crypto';
import type {
  PreviewInspectorRouteSelectionStep,
  PreviewRouteExecutionPlanArtifact,
} from '../../src/domain/preview';
import {
  PREVIEW_ROUTE_EXECUTION_PLAN_POLICY_DIGEST,
  PREVIEW_ROUTE_EXECUTION_PLAN_POLICY_VERSION,
  stablePreviewRouteExecutionPlanJson,
} from '../../src/adapters/esbuild/previewRouteExecutionPlan';

interface PreviewRouteExecutionPlanFixtureOptions {
  readonly componentName: string;
  readonly exportName?: string;
  readonly pathname: string;
  readonly pattern: string;
  readonly routeId: string;
  readonly selection: readonly PreviewInspectorRouteSelectionStep[];
  readonly sourcePath: string;
}

/** Creates a self-consistent compact artifact for orchestration tests that mock compilation. */
export function createPreviewRouteExecutionPlanFixture(
  options: PreviewRouteExecutionPlanFixtureOptions,
): PreviewRouteExecutionPlanArtifact {
  const exportName = options.exportName ?? 'default';
  const planningContext = Object.freeze({
    compilerPolicyDigest: digest('compiler'),
    preparationPolicyDigest: digest('fast'),
    requestDigest: digest(`request:${options.routeId}`),
    resolutionConfinementDigest: digest('confinement'),
    resolverDigest: digest('resolver'),
    sourceSnapshotDigest: digest(`source:${options.sourcePath}`),
  });
  const planningContextDigest = digest(stablePreviewRouteExecutionPlanJson(planningContext));
  const rootRole = Object.freeze({
    exportName,
    sourcePath: options.sourcePath,
    surfaceId: `surface:${options.routeId}`,
  });
  const payload = {
    browserCandidateId: `browser:${options.routeId}`,
    executionCandidateId: `execution:${options.routeId}`,
    executionIdentity: digest(`execution:${options.routeId}`),
    executionRoot: rootRole,
    frontierIdentity: digest(`frontier:${options.routeId}`),
    ownerChain: Object.freeze([
      Object.freeze({
        basePattern: '/',
        exportName,
        sourcePath: options.sourcePath,
      }),
    ]),
    pageCandidateId: `page:${options.routeId}`,
    planningContext,
    planningContextDigest,
    policyDigest: PREVIEW_ROUTE_EXECUTION_PLAN_POLICY_DIGEST,
    rootRoleContract: Object.freeze({
      ...rootRole,
      preparedSourceDigest: digest(`root:${options.sourcePath}`),
    }),
    routeId: options.routeId,
    runtimeTarget: rootRole,
    selectedBranch: Object.freeze({
      componentName: options.componentName,
      exportName,
      id: options.routeId,
      pathname: options.pathname,
      pattern: options.pattern,
      sourcePath: options.sourcePath,
    }),
    selection: Object.freeze(options.selection.map((step) => Object.freeze({ ...step }))),
    targetRoleContract: Object.freeze({
      ...rootRole,
      preparedSourceDigest: digest(`target:${options.sourcePath}`),
    }),
    version: PREVIEW_ROUTE_EXECUTION_PLAN_POLICY_VERSION,
  };
  return Object.freeze({
    ...payload,
    digest: digest(stablePreviewRouteExecutionPlanJson(payload)),
  });
}

/** Computes compact deterministic fixture identities. */
function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

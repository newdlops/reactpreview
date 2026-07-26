/* eslint-disable jsdoc/require-jsdoc, @typescript-eslint/unbound-method, @typescript-eslint/no-unnecessary-condition, @typescript-eslint/prefer-optional-chain */
/** Converts selected render evidence into role-labelled, non-executable Page Execution segments. */
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { PreviewRenderChainStep, PreviewRenderExportReference } from '../renderGraph';
import type { PreviewInspectorAncestorPlan } from './previewInspectorAncestorPlan';
import type { PreviewInspectorPageCandidate } from './previewInspectorAncestorTypes';
import type {
  PreviewInspectorPagePathSegment,
  PreviewInspectorPagePathSegmentRole,
} from './previewInspectorPageExecutionTypes';

export interface CreatePreviewInspectorPagePathSegmentsOptions {
  readonly candidate: PreviewInspectorPageCandidate;
  readonly plan: PreviewInspectorAncestorPlan;
}

/**
 * Produces inner-to-outer path segments. The result is evidence only: callers must create a Mount
 * Surface before any segment can become executable code.
 */
export function createPreviewInspectorPagePathSegments(
  options: CreatePreviewInspectorPagePathSegmentsOptions,
): readonly PreviewInspectorPagePathSegment[] {
  const renderPath =
    options.candidate.renderPath ??
    options.plan.renderChainsByExport[options.plan.target.exportName]?.paths[0] ??
    options.plan.renderChain.paths[0];
  const steps = renderPath?.steps ?? [];
  const rootStepIndex = options.candidate.rootStepIndex;
  const segments = steps.map((step, index) =>
    createSegment({
      candidate: options.candidate,
      indexFromTarget: index,
      plan: options.plan,
      rootStepIndex,
      step,
    }),
  );
  if (!segments.some((segment) => isSameReference(segment.reference, options.plan.target))) {
    segments.unshift(
      createSyntheticTargetSegment(options.plan.target, options.candidate.id, segments.length),
    );
  }
  const entryPoint = renderPath?.entryPoint;
  if (
    entryPoint !== undefined &&
    !segments.some(
      (segment) => path.normalize(segment.sourcePath) === path.normalize(entryPoint.sourcePath),
    )
  ) {
    segments.push(
      Object.freeze({
        certainty: 'confirmed',
        evidenceSourcePaths: Object.freeze([path.normalize(entryPoint.sourcePath)]),
        id: createSegmentIdentity({
          candidateId: options.candidate.id,
          occurrenceStart: entryPoint.occurrenceStart,
          role: 'application-entry',
          sourcePath: entryPoint.sourcePath,
          stepIndex: segments.length,
        }),
        indexFromTarget: segments.length,
        role: 'application-entry',
        sourcePath: path.normalize(entryPoint.sourcePath),
        wrapperNames: Object.freeze([...entryPoint.wrapperNames]),
      }),
    );
  }
  return Object.freeze(
    segments.map((segment, index) => Object.freeze({ ...segment, indexFromTarget: index })),
  );
}

function createSegment(options: {
  readonly candidate: PreviewInspectorPageCandidate;
  readonly indexFromTarget: number;
  readonly plan: PreviewInspectorAncestorPlan;
  readonly rootStepIndex: number | undefined;
  readonly step: PreviewRenderChainStep;
}): PreviewInspectorPagePathSegment {
  const sourcePath = path.normalize(options.step.sourcePath);
  const reference = readExactReference(options, sourcePath);
  const role = classifySegmentRole(options, sourcePath, reference, options.indexFromTarget);
  return Object.freeze({
    certainty: options.step.certainty,
    evidenceSourcePaths: Object.freeze(
      [
        ...new Set([sourcePath, ...(options.step.evidenceSourcePaths ?? []).map(path.normalize)]),
      ].sort(),
    ),
    id: createSegmentIdentity({
      candidateId: options.candidate.id,
      occurrenceStart: options.step.occurrenceStart,
      role,
      sourcePath,
      stepIndex: options.indexFromTarget,
    }),
    indexFromTarget: options.indexFromTarget,
    ...(options.step.invocation === undefined ? {} : { invocation: options.step.invocation }),
    ...(reference === undefined ? {} : { reference }),
    role,
    sourcePath,
    wrapperNames: Object.freeze([...options.step.wrapperNames]),
  });
}

function readExactReference(
  options: {
    readonly candidate: PreviewInspectorPageCandidate;
    readonly plan: PreviewInspectorAncestorPlan;
  },
  sourcePath: string,
): PreviewRenderExportReference | undefined {
  if (path.normalize(options.plan.target.sourcePath) === sourcePath) return options.plan.target;
  if (path.normalize(options.candidate.root.sourcePath) === sourcePath)
    return options.candidate.root;
  const routeLocation = options.candidate.routeLocation;
  if (routeLocation !== undefined && 'routeMounts' in routeLocation) {
    const mount = routeLocation.routeMounts?.find(
      (item) => path.normalize(item.sourcePath) === sourcePath,
    );
    if (mount !== undefined) return { exportName: mount.exportName, sourcePath: mount.sourcePath };
  }
  const layout = options.candidate.nextAppLayoutChain?.find(
    (item) => path.normalize(item.sourcePath) === sourcePath,
  );
  if (layout !== undefined) return { exportName: layout.exportName, sourcePath: layout.sourcePath };
  if (
    options.candidate.nextPagesShell !== undefined &&
    path.normalize(options.candidate.nextPagesShell.app.sourcePath) === sourcePath
  ) {
    return options.candidate.nextPagesShell.app;
  }
  return undefined;
}

function classifySegmentRole(
  options: {
    readonly candidate: PreviewInspectorPageCandidate;
    readonly plan: PreviewInspectorAncestorPlan;
    readonly rootStepIndex: number | undefined;
    readonly step: PreviewRenderChainStep;
  },
  sourcePath: string,
  reference: PreviewRenderExportReference | undefined,
  stepIndex: number,
): PreviewInspectorPagePathSegmentRole {
  if (path.normalize(options.plan.target.sourcePath) === sourcePath) return 'target';
  if (options.step.kind === 'entry-render') return 'application-entry';
  if (
    options.candidate.nextAppLayoutChain?.some(
      (item) => path.normalize(item.sourcePath) === sourcePath,
    )
  ) {
    return 'framework-layout';
  }
  if (
    options.candidate.nextPagesShell !== undefined &&
    path.normalize(options.candidate.nextPagesShell.app.sourcePath) === sourcePath
  ) {
    return 'framework-layout';
  }
  if (
    reference !== undefined &&
    path.normalize(reference.sourcePath) === path.normalize(options.candidate.root.sourcePath)
  ) {
    return 'page-content';
  }
  if (
    options.candidate.routeLocation !== undefined &&
    'routeMounts' in options.candidate.routeLocation
  ) {
    if (
      options.candidate.routeLocation.routeMounts?.some(
        (item) => path.normalize(item.sourcePath) === sourcePath,
      )
    ) {
      return 'route-layout';
    }
  }
  if (options.rootStepIndex !== undefined && stepIndex > options.rootStepIndex)
    return 'application-shell';
  if (options.step.kind === 'route-branch') return 'route-element';
  return 'evidence-only';
}

function createSyntheticTargetSegment(
  target: PreviewRenderExportReference,
  candidateId: string,
  indexFromTarget: number,
): PreviewInspectorPagePathSegment {
  const sourcePath = path.normalize(target.sourcePath);
  return Object.freeze({
    certainty: 'confirmed',
    evidenceSourcePaths: Object.freeze([sourcePath]),
    id: createSegmentIdentity({
      candidateId,
      occurrenceStart: -1,
      role: 'target',
      sourcePath,
      stepIndex: indexFromTarget,
    }),
    indexFromTarget,
    reference: target,
    role: 'target',
    sourcePath,
    wrapperNames: Object.freeze([]),
  });
}

function createSegmentIdentity(options: {
  readonly candidateId: string;
  readonly occurrenceStart: number;
  readonly role: PreviewInspectorPagePathSegmentRole;
  readonly sourcePath: string;
  readonly stepIndex: number;
}): string {
  return createHash('sha256')
    .update(
      [
        options.candidateId,
        options.stepIndex.toString(),
        options.sourcePath,
        options.occurrenceStart.toString(),
        options.role,
      ].join('\0'),
    )
    .digest('hex')
    .slice(0, 24);
}

function isSameReference(
  reference: PreviewRenderExportReference | undefined,
  target: PreviewRenderExportReference,
): boolean {
  return (
    reference !== undefined &&
    reference.exportName === target.exportName &&
    path.normalize(reference.sourcePath) === path.normalize(target.sourcePath)
  );
}

/** Canonical campaign route execution-plan creation and fail-closed comparison. */
import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import {
  PreviewRouteExecutionPlanInvariantError,
  type PreviewBuildRequest,
  type PreviewRouteExecutionPlanArtifact,
  type PreviewRouteExecutionPlanInvariantEvidence,
  type PreviewRouteExecutionPlanningContextIdentity,
} from '../../domain/preview';
import type { PreviewInspectorAncestorPlan } from './inspector/previewInspectorAncestorTypes';
import type { PreviewInspectorExecutionRootModuleContract } from './inspector/previewInspectorExecutionRootModuleContract';
import type { PreviewInspectorPageExecutionCandidate } from './inspector/previewInspectorPageExecutionTypes';
import type { PreviewInspectorTargetModuleContract } from './inspector/previewInspectorTargetModuleContract';
import type { PreviewPreparationPolicy } from './previewPreparationPolicy';

export const PREVIEW_ROUTE_EXECUTION_PLAN_POLICY_VERSION = 2;
export const PREVIEW_ROUTE_EXECUTION_PLAN_POLICY_DIGEST = digestCanonical({
  artifactDigest: 'canonical-json-excluding-digest',
  candidateSelection: 'real-fast-final-frontier-selected-exact-route',
  comparison: 'schema-policy-context-and-field-equality-before-esbuild',
  frontierAuthority:
    'one-final-pre-esbuild-frontier-with-setup-runtime-style-companions-and-snapshot-reader',
  ordinaryEditorRequests: 'artifact-optional-existing-selection-semantics',
  pathTrust: 'compiler-recomputed-and-resolution-confined',
  policyVersion: PREVIEW_ROUTE_EXECUTION_PLAN_POLICY_VERSION,
  structuralFailure: 'bounded-route-plan-invariant-before-esbuild',
});

const PREVIEW_ROUTE_EXECUTION_CONTEXT_POLICY_VERSION = 1;
const MAX_ARTIFACT_BYTES = 64 * 1024;
const MAX_IDENTITY_TEXT = 4_096;
const MAX_SELECTION_STEPS = 64;

/** Inputs whose stable digests bind an artifact to one immutable compiler planning context. */
export interface CreatePreviewRouteExecutionPlanningContextOptions {
  readonly preparationPolicy: PreviewPreparationPolicy;
  readonly projectRoot: string;
  readonly request: PreviewBuildRequest;
}

/** Inputs selected by the shared real fast route planner before any esbuild build starts. */
export interface CreatePreviewRouteExecutionPlanArtifactOptions {
  readonly candidate: PreviewInspectorPageExecutionCandidate;
  readonly executionRootModuleContract: PreviewInspectorExecutionRootModuleContract;
  readonly frontierIdentity: string;
  readonly plan: PreviewInspectorAncestorPlan;
  readonly planningContext: PreviewRouteExecutionPlanningContextIdentity;
  readonly routeId: string;
  readonly targetModuleContract: PreviewInspectorTargetModuleContract;
}

/** Inputs for a structural recreation failure that occurs before canonical artifact comparison. */
export interface CreatePreviewRouteExecutionPlanStructuralInvariantErrorOptions {
  readonly expectedArtifact: unknown;
  readonly mismatchField: string;
  readonly observedCandidateId?: string;
  readonly observedResolution?: 'automatic' | 'exact' | 'fallback' | 'missing';
  readonly observedRootIdentity?: string;
  readonly observedTargetIdentity?: string;
  readonly reason: string;
}

/**
 * Creates the compact context identity shared by inventory analysis and actual compilation.
 *
 * Source contents are represented only by SHA-256 identities. The serialized artifact therefore
 * contains no source text, environment values, or dependency contents.
 */
export function createPreviewRouteExecutionPlanningContext(
  options: CreatePreviewRouteExecutionPlanningContextOptions,
): PreviewRouteExecutionPlanningContextIdentity {
  const request = options.request;
  const sourceSnapshots = [
    {
      documentPath: path.normalize(request.documentPath),
      ...(request.documentVersion === undefined ? {} : { documentVersion: request.documentVersion }),
      language: request.language,
      sourceDigest: digestText(request.sourceText),
    },
    ...request.dependencySnapshots.map((snapshot) => ({
      documentPath: path.normalize(snapshot.documentPath),
      ...(snapshot.documentVersion === undefined
        ? {}
        : { documentVersion: snapshot.documentVersion }),
      language: snapshot.language,
      sourceDigest: digestText(snapshot.sourceText),
    })),
  ].sort((left, right) => left.documentPath.localeCompare(right.documentPath));
  const tsconfigSource =
    request.tsconfigPath === undefined ? undefined : ts.sys.readFile(request.tsconfigPath);
  const planningRequest = {
    ...(request.buildIntent === undefined ? {} : { buildIntent: request.buildIntent }),
    documentPath: path.normalize(request.documentPath),
    ...(request.documentVersion === undefined ? {} : { documentVersion: request.documentVersion }),
    language: request.language,
    ...(request.maxOutputMebibytes === undefined
      ? {}
      : { maxOutputMebibytes: request.maxOutputMebibytes }),
    preparationMode: request.preparationMode ?? 'full',
    ...(request.inspectorRouteSelection === undefined
      ? {}
      : {
          inspectorRouteSelection: request.inspectorRouteSelection.map((step) => ({
            componentName: step.componentName,
            pattern: step.pattern,
          })),
        }),
    ...(request.inspectorTargetMode === undefined
      ? {}
      : { inspectorTargetMode: request.inspectorTargetMode }),
    ...(request.inspectorPageCandidateId === undefined
      ? {}
      : { inspectorPageCandidateId: request.inspectorPageCandidateId }),
    ...(request.inspectorPageExecutionCandidateId === undefined
      ? {}
      : { inspectorPageExecutionCandidateId: request.inspectorPageExecutionCandidateId }),
    renderMode: request.renderMode ?? 'component',
    ...(request.setupModulePath === undefined
      ? {}
      : { setupModulePath: path.normalize(request.setupModulePath) }),
    ...(request.tsconfigPath === undefined
      ? {}
      : { tsconfigPath: path.normalize(request.tsconfigPath) }),
    useStorybookPreview: request.useStorybookPreview ?? true,
    workspaceRoot: path.normalize(request.workspaceRoot),
  };
  const compilerPolicyDigest = digestCanonical({
    contextPolicyVersion: PREVIEW_ROUTE_EXECUTION_CONTEXT_POLICY_VERSION,
    executionPlanPolicyDigest: PREVIEW_ROUTE_EXECUTION_PLAN_POLICY_DIGEST,
    frontierIdentity: 'compiler-owned-page-execution-frontier',
    pageExecutionPlanVersion: 4,
    runtimeOwnership: 'selected-route-leaf-exact-fail-closed',
  });
  return Object.freeze({
    compilerPolicyDigest,
    preparationPolicyDigest: digestCanonical(options.preparationPolicy),
    requestDigest: digestCanonical(planningRequest),
    resolutionConfinementDigest: digestCanonical(request.resolutionConfinement ?? null),
    resolverDigest: digestCanonical({
      projectRoot: path.normalize(options.projectRoot),
      tsconfigPath:
        request.tsconfigPath === undefined ? null : path.normalize(request.tsconfigPath),
      tsconfigSourceDigest: tsconfigSource === undefined ? null : digestText(tsconfigSource),
      workspaceRoot: path.normalize(request.workspaceRoot),
    }),
    sourceSnapshotDigest: digestCanonical(sourceSnapshots),
  });
}

/** Freezes one canonical artifact and computes its self-digest without the digest field. */
export function createPreviewRouteExecutionPlanArtifact(
  options: CreatePreviewRouteExecutionPlanArtifactOptions,
): PreviewRouteExecutionPlanArtifact {
  const selectedBranchId = options.plan.selectedRouteBranchId;
  const selectedBranch =
    selectedBranchId === undefined
      ? undefined
      : options.plan.routeBranches?.find((branch) => branch.id === selectedBranchId);
  const location = options.candidate.browserCandidate.routeLocation;
  const sourcePath = selectedBranch?.sourcePath;
  const exportName = selectedBranch?.exportName;
  if (
    options.plan.routeSelectionResolution !== 'exact' ||
    selectedBranch === undefined ||
    sourcePath === undefined ||
    exportName === undefined ||
    location === undefined ||
    !('pattern' in location) ||
    !('pathname' in location)
  ) {
    throw createInvariantError({
      mismatchField: 'routeSelectionResolution',
      observedCandidateId: options.candidate.id,
      observedResolution: options.plan.routeSelectionResolution ?? 'missing',
      reason: 'the real fast planner did not produce one exact selected route branch',
      routeId: options.routeId,
    });
  }
  if (selectedBranch.id !== options.routeId) {
    throw createInvariantError({
      mismatchField: 'selectedBranch.id',
      observedCandidateId: options.candidate.id,
      observedResolution: options.plan.routeSelectionResolution,
      reason: 'the real fast planner selected a different route branch',
      routeId: options.routeId,
    });
  }
  const candidate = options.candidate;
  const rootRole = candidate.executionRootContract;
  const targetRole = candidate.runtimeTargetContract;
  if (
    !sameRole(rootRole, options.executionRootModuleContract) ||
    options.executionRootModuleContract.preparedSourceDigest.length !== 64
  ) {
    throw createInvariantError({
      mismatchField: 'rootRoleContract',
      observedCandidateId: candidate.id,
      observedResolution: options.plan.routeSelectionResolution,
      observedRootIdentity: formatRole(rootRole),
      reason: 'the prepared execution-root contract does not match the selected candidate',
      routeId: options.routeId,
    });
  }
  if (
    path.normalize(options.targetModuleContract.sourcePath) !==
      path.normalize(targetRole.sourcePath) ||
    !options.targetModuleContract.selectedExportNames.includes(targetRole.exportName) ||
    options.targetModuleContract.preparedSourceDigest.length !== 64
  ) {
    throw createInvariantError({
      mismatchField: 'targetRoleContract',
      observedCandidateId: candidate.id,
      observedResolution: options.plan.routeSelectionResolution,
      observedTargetIdentity: formatRole(targetRole),
      reason: 'the prepared target contract does not match the selected candidate',
      routeId: options.routeId,
    });
  }
  const routeMounts = 'routeMounts' in location ? location.routeMounts : [];
  const ownerChain = Object.freeze(
    (routeMounts.length === 0
      ? [
          {
            basePattern: candidate.routeRecipe?.mounts[0]?.basePath ?? '/',
            exportName: rootRole.exportName,
            sourcePath: path.normalize(rootRole.sourcePath),
          },
        ]
      : routeMounts.map((mount) => ({
          basePattern: mount.basePath,
          exportName: mount.exportName,
          sourcePath: path.normalize(mount.sourcePath),
        }))
    ).map((owner) => Object.freeze(owner)),
  );
  const planningContextDigest = digestCanonical(options.planningContext);
  const executionIdentity = digestCanonical({
    candidate,
    frontierIdentity: options.frontierIdentity,
    pageExecutionPlanVersion: 4,
  });
  const withoutDigest = {
    browserCandidateId: candidate.browserCandidate.id,
    executionCandidateId: candidate.id,
    executionIdentity,
    executionRoot: freezeRole(rootRole),
    frontierIdentity: options.frontierIdentity,
    ownerChain,
    pageCandidateId: candidate.browserCandidate.id,
    planningContext: options.planningContext,
    planningContextDigest,
    policyDigest: PREVIEW_ROUTE_EXECUTION_PLAN_POLICY_DIGEST,
    ...(candidate.routeRecipe === undefined
      ? {}
      : {
          recipe: Object.freeze({
            kind: candidate.routeRecipe.kind,
            mounts: Object.freeze(
              candidate.routeRecipe.mounts.map((mount) => Object.freeze({ ...mount })),
            ),
            params: freezeRouteRecord(candidate.routeRecipe.params),
            pathname: candidate.routeRecipe.pathname,
            pattern: candidate.routeRecipe.pattern,
            rootOwnsRouter: candidate.routeRecipe.rootOwnsRouter,
            ...(candidate.routeRecipe.routerModuleSpecifier === undefined
              ? {}
              : { routerModuleSpecifier: candidate.routeRecipe.routerModuleSpecifier }),
            searchParams: freezeRouteRecord(candidate.routeRecipe.searchParams),
          }),
        }),
    rootRoleContract: Object.freeze({
      ...freezeRole(rootRole),
      preparedSourceDigest: options.executionRootModuleContract.preparedSourceDigest,
    }),
    routeId: options.routeId,
    runtimeTarget: freezeRole(targetRole),
    selectedBranch: Object.freeze({
      componentName: selectedBranch.componentName,
      exportName,
      id: selectedBranch.id,
      pathname: selectedBranch.pathname,
      pattern: selectedBranch.pattern,
      sourcePath: path.normalize(sourcePath),
    }),
    selection: Object.freeze(
      selectedBranch.selectionPath.map((step) =>
        Object.freeze({ componentName: step.componentName, pattern: step.pattern }),
      ),
    ),
    targetRoleContract: Object.freeze({
      ...freezeRole(targetRole),
      preparedSourceDigest: options.targetModuleContract.preparedSourceDigest,
    }),
    version: PREVIEW_ROUTE_EXECUTION_PLAN_POLICY_VERSION,
  };
  return Object.freeze({
    ...withoutDigest,
    digest: digestCanonical(withoutDigest),
  });
}

/** Validates a frozen request artifact against the independently recreated current artifact. */
export function assertPreviewRouteExecutionPlanArtifact(
  expected: unknown,
  observed: PreviewRouteExecutionPlanArtifact,
  observedResolution: 'automatic' | 'exact' | 'fallback' | undefined,
): void {
  const routeId = boundedText(readRecordValue(expected, 'routeId'), '<invalid-route>');
  const expectedContextDigest = boundedDigest(
    readRecordValue(expected, 'planningContextDigest'),
  );
  const expectedPlanDigest = boundedDigest(readRecordValue(expected, 'digest'));
  const expectedPolicyDigest = boundedDigest(readRecordValue(expected, 'policyDigest'));
  const observedCandidateId = boundedText(observed.executionCandidateId);
  const observedContextDigest = boundedDigest(observed.planningContextDigest);
  const observedPlanDigest = boundedDigest(observed.digest);
  const observedPolicyDigest = boundedDigest(observed.policyDigest);
  const observedRootIdentity = boundedRole(observed.executionRoot);
  const observedTargetIdentity = boundedRole(observed.runtimeTarget);
  const fail = (mismatchField: string, reason: string): never => {
    throw createInvariantError({
      ...(expectedContextDigest === undefined ? {} : { expectedContextDigest }),
      ...(expectedPlanDigest === undefined ? {} : { expectedPlanDigest }),
      ...(expectedPolicyDigest === undefined ? {} : { expectedPolicyDigest }),
      mismatchField,
      ...(observedCandidateId.length === 0 ? {} : { observedCandidateId }),
      ...(observedContextDigest === undefined ? {} : { observedContextDigest }),
      ...(observedPlanDigest === undefined ? {} : { observedPlanDigest }),
      ...(observedPolicyDigest === undefined ? {} : { observedPolicyDigest }),
      observedResolution: observedResolution ?? 'missing',
      ...(observedRootIdentity === undefined ? {} : { observedRootIdentity }),
      ...(observedTargetIdentity === undefined ? {} : { observedTargetIdentity }),
      reason,
      routeId,
    });
  };
  assertArtifactShape(expected, fail);
  if (expected.version !== PREVIEW_ROUTE_EXECUTION_PLAN_POLICY_VERSION)
    fail('version', 'the frozen artifact version is stale or unsupported');
  if (expected.policyDigest !== PREVIEW_ROUTE_EXECUTION_PLAN_POLICY_DIGEST)
    fail('policyDigest', 'the frozen artifact policy is stale or unsupported');
  if (digestArtifact(expected) !== expected.digest)
    fail('digest', 'the frozen artifact payload digest is invalid');
  if (expected.planningContextDigest !== digestCanonical(expected.planningContext))
    fail('planningContextDigest', 'the frozen planning-context digest is invalid');
  if (observedResolution !== 'exact')
    fail('routeSelectionResolution', 'the current fast planner did not recreate an exact selection');
  const expectedPayload = stripArtifactDigest(expected);
  const observedPayload = stripArtifactDigest(observed);
  const mismatch =
    findFirstMismatch(expectedPayload, observedPayload) ??
    (expected.digest === observed.digest ? undefined : 'digest');
  if (mismatch !== undefined)
    fail(mismatch, 'the current fast compiler plan differs from the frozen artifact');
}

/**
 * Converts plan-backed structural recreation drift into the same bounded evidence used by canonical
 * comparison failures. Cancellation and genuine resource errors must be filtered by the caller.
 */
export function createPreviewRouteExecutionPlanStructuralInvariantError(
  options: CreatePreviewRouteExecutionPlanStructuralInvariantErrorOptions,
): PreviewRouteExecutionPlanInvariantError {
  const expected = options.expectedArtifact;
  const expectedContextDigest = boundedDigest(
    readRecordValue(expected, 'planningContextDigest'),
  );
  const expectedPlanDigest = boundedDigest(readRecordValue(expected, 'digest'));
  const expectedPolicyDigest = boundedDigest(readRecordValue(expected, 'policyDigest'));
  return createInvariantError({
    ...(expectedContextDigest === undefined ? {} : { expectedContextDigest }),
    ...(expectedPlanDigest === undefined ? {} : { expectedPlanDigest }),
    ...(expectedPolicyDigest === undefined ? {} : { expectedPolicyDigest }),
    mismatchField: options.mismatchField,
    ...(options.observedCandidateId === undefined
      ? {}
      : { observedCandidateId: boundedText(options.observedCandidateId) }),
    ...(options.observedResolution === undefined
      ? { observedResolution: 'missing' as const }
      : { observedResolution: options.observedResolution }),
    ...(options.observedRootIdentity === undefined
      ? {}
      : { observedRootIdentity: boundedText(options.observedRootIdentity) }),
    ...(options.observedTargetIdentity === undefined
      ? {}
      : { observedTargetIdentity: boundedText(options.observedTargetIdentity) }),
    reason: options.reason,
    routeId: boundedText(readRecordValue(expected, 'routeId'), '<invalid-route>'),
  });
}

/** Stable canonical JSON used for all artifact and context digests. */
export function stablePreviewRouteExecutionPlanJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((item) => stablePreviewRouteExecutionPlanJson(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${stablePreviewRouteExecutionPlanJson(item)}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Narrows untrusted structured-clone input to the compact fields needed for canonical validation. */
function assertArtifactShape(
  artifact: unknown,
  fail: (field: string, reason: string) => never,
): asserts artifact is PreviewRouteExecutionPlanArtifact {
  if (typeof artifact !== 'object' || artifact === null)
    fail('schema', 'the frozen artifact does not match the required compact schema');
  let serialized: string;
  try {
    serialized = JSON.stringify(artifact);
  } catch {
    fail('schema', 'the frozen artifact is not acyclic serializable data');
  }
  if (serialized.length > MAX_ARTIFACT_BYTES)
    fail('schema', 'the frozen artifact exceeds the bounded payload size');
  const record = artifact as Record<string, unknown>;
  const selection = record.selection;
  if (
    typeof record.routeId !== 'string' ||
    typeof record.digest !== 'string' ||
    typeof record.policyDigest !== 'string' ||
    typeof record.planningContextDigest !== 'string' ||
    !Array.isArray(selection) ||
    selection.length === 0 ||
    selection.length > MAX_SELECTION_STEPS
  ) {
    fail('schema', 'the frozen artifact does not match the required compact schema');
  }
}

/** Recomputes an artifact self-digest without trusting its serialized digest field. */
function digestArtifact(artifact: PreviewRouteExecutionPlanArtifact): string {
  return digestCanonical(stripArtifactDigest(artifact));
}

/** Returns the first deterministic canonical field that differs between two artifacts. */
function findFirstMismatch(left: unknown, right: unknown, prefix = ''): string | undefined {
  if (Object.is(left, right)) return undefined;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return prefix || 'artifact';
    if (left.length !== right.length) return `${prefix}.length`;
    for (let index = 0; index < left.length; index += 1) {
      const mismatch = findFirstMismatch(left[index], right[index], `${prefix}[${index.toString()}]`);
      if (mismatch !== undefined) return mismatch;
    }
    return undefined;
  }
  if (
    left !== null &&
    right !== null &&
    typeof left === 'object' &&
    typeof right === 'object'
  ) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort();
    for (const key of keys) {
      if (!Object.hasOwn(leftRecord, key) || !Object.hasOwn(rightRecord, key))
        return prefix.length === 0 ? key : `${prefix}.${key}`;
      const mismatch = findFirstMismatch(
        leftRecord[key],
        rightRecord[key],
        prefix.length === 0 ? key : `${prefix}.${key}`,
      );
      if (mismatch !== undefined) return mismatch;
    }
    return undefined;
  }
  return prefix || 'artifact';
}

/** Freezes a normalized source/export/surface role identity. */
function freezeRole(role: {
  readonly exportName: string;
  readonly sourcePath: string;
  readonly surfaceId: string;
}): Readonly<{ exportName: string; sourcePath: string; surfaceId: string }> {
  return Object.freeze({
    exportName: role.exportName,
    sourcePath: path.normalize(role.sourcePath),
    surfaceId: role.surfaceId,
  });
}

/** Compares two role identities after normalizing filesystem spelling. */
function sameRole(
  left: { readonly exportName: string; readonly sourcePath: string; readonly surfaceId: string },
  right: { readonly exportName: string; readonly sourcePath: string; readonly surfaceId: string },
): boolean {
  return (
    left.exportName === right.exportName &&
    path.normalize(left.sourcePath) === path.normalize(right.sourcePath) &&
    left.surfaceId === right.surfaceId
  );
}

/** Freezes route parameter records in stable key order. */
function freezeRouteRecord(
  record: Readonly<Record<string, string | readonly string[]>>,
): Readonly<Record<string, string | readonly string[]>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(record)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [
          key,
          typeof value === 'string' ? value : Object.freeze([...value]),
        ]),
    ),
  );
}

/** Builds one bounded campaign invariant error suitable for worker serialization and ledgers. */
function createInvariantError(
  input: Omit<
    PreviewRouteExecutionPlanInvariantEvidence,
    'requestedResolution' | 'observedResolution'
  > & {
    readonly observedResolution?: PreviewRouteExecutionPlanInvariantEvidence['observedResolution'];
  },
): PreviewRouteExecutionPlanInvariantError {
  const { observedResolution, ...rest } = input;
  return new PreviewRouteExecutionPlanInvariantError(
    Object.freeze({
      ...rest,
      mismatchField: boundedText(input.mismatchField, 'artifact'),
      ...(observedResolution === undefined ? {} : { observedResolution }),
      reason: boundedText(input.reason, 'route execution-plan invariant failed'),
      requestedResolution: 'exact' as const,
      routeId: boundedText(input.routeId, '<invalid-route>'),
    }),
  );
}

/** Formats an optional observed role without allowing unbounded evidence text. */
function boundedRole(
  role:
    | {
        readonly exportName?: unknown;
        readonly sourcePath?: unknown;
        readonly surfaceId?: unknown;
      }
    | undefined,
): string | undefined {
  if (role === undefined) return undefined;
  return boundedText(
    `${String(role.sourcePath)}\0${String(role.exportName)}\0${String(role.surfaceId)}`,
  );
}

/** Formats one exact internal role identity for bounded diagnostic evidence. */
function formatRole(role: {
  readonly exportName: string;
  readonly sourcePath: string;
  readonly surfaceId: string;
}): string {
  return `${path.normalize(role.sourcePath)}\0${role.exportName}\0${role.surfaceId}`;
}

/** Coerces only trusted string values and applies the evidence-size limit. */
function boundedText(value: unknown, fallback?: string): string {
  const text = typeof value === 'string' ? value : (fallback ?? '');
  return text.slice(0, MAX_IDENTITY_TEXT);
}

/** Retains at most one SHA-256-sized digest for mismatch evidence. */
function boundedDigest(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, 64) : undefined;
}

/** Computes a SHA-256 identity for source or canonical JSON text. */
function digestText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Computes a SHA-256 identity over stable canonical JSON. */
function digestCanonical(value: unknown): string {
  return digestText(stablePreviewRouteExecutionPlanJson(value));
}

/** Reads one own property from an untrusted structured-clone value. */
function readRecordValue(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/** Returns the canonical artifact payload without its self-digest. */
function stripArtifactDigest(
  artifact: PreviewRouteExecutionPlanArtifact,
): Readonly<Record<string, unknown>> {
  return Object.freeze(
    Object.fromEntries(Object.entries(artifact).filter(([key]) => key !== 'digest')),
  );
}

/**
 * Extracts package roots from esbuild's unresolved-module diagnostics for one bounded acquisition
 * retry. Only package names already declared by the active project are admitted; strict npm aliases
 * are supported while local links, URLs, Node built-ins, typos, and plugin-private identities fail.
 */
import { builtinModules } from 'node:module';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Message } from 'esbuild';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import { collectPreviewInspectorRuntimeImportInventory } from './inspector/previewInspectorRuntimeImportInventory';
import { parsePreviewCssImports } from './previewCssImportParser';
import {
  findPreviewDependencySpecifier,
  findPreviewReactDomCompanionSpecifier,
  type PreviewDependencyProfile,
} from '../node/previewDependencyProfile';
import type {
  PreviewManagedDependencyEnvironment,
  PreviewManagedDependencyStore,
} from '../node/previewManagedDependencyStore';
import { hasExplicitPreviewServerBoundary } from './previewDependencyResolutionHintPlugin';
import {
  PreviewDependencyResolutionNeuralModel,
  type PreviewDependencyResolutionNeuralFeatures,
  type PreviewDependencyResolutionNeuralScore,
} from './previewDependencyResolutionNeuralModel';

const UNRESOLVED_PACKAGE_PATTERN = /^Could not resolve "([^"]+)"$/u;
const PACKAGE_ROOT_PATTERN =
  /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/u;
const NODE_BUILTIN_NAMES = new Set(
  builtinModules.flatMap((moduleName) => {
    const normalizedName = moduleName.replace(/^node:/u, '');
    return [normalizedName, `node:${normalizedName}`];
  }),
);
const MAXIMUM_HINT_SOURCE_BYTES = 2 * 1024 * 1024;
const MAXIMUM_ACQUISITION_BATCH_ATTEMPTS = 12;
const MAXIMUM_PACKAGES_PER_ACQUISITION_BATCH = 12;
const MINIMUM_ACQUISITION_SPLIT_SIZE = 5;
const CORE_RUNTIME_PACKAGE_PATTERN = /^(?:react|react-dom)$/u;
const UI_PACKAGE_PATTERN =
  /^(?:@dnd-kit\/|@radix-ui\/|@tiptap\/|class-variance-authority$|lucide-react$|next-themes$|pretendard$|radix-ui$|react-|sonner$|tailwindcss$|tw-animate-css$)/u;
const SERVER_PACKAGE_PATTERN =
  /^(?:@ai-sdk\/|@auth\/|@aws-sdk\/|@neondatabase\/|@prisma\/|@upstash\/|google-auth-library$|next-auth$|pg$|pino$|prisma$|server-only$|sharp$|undici$|web-push$|ws$)/u;
const SERVER_SOURCE_PATH_PATTERN =
  /(?:^|[/\\._-])(?:action|api|auth|backend|database|db|job|logger|logging|mail|queue|server|service|worker)s?(?=$|[/\\._-])/iu;
const SERVER_RUNTIME_SOURCE_PATTERN =
  /\b(?:process\.env|require\s*\(\s*["'](?:node:)?(?:child_process|crypto|fs|http|https|net|os|path|stream|tls|worker_threads|zlib)(?:\/[^"']*)?["']|from\s*["'](?:node:)?(?:child_process|crypto|fs|http|https|net|os|path|stream|tls|worker_threads|zlib)(?:\/[^"']*)?["'])/u;
const STYLE_SOURCE_PATTERN = /\.(?:css|less|sass|scss|styl)$/iu;
const STYLE_MODULE_PATTERN = /\.(?:css|less|sass|scss|styl)$/iu;

/** Environment facts retained outside the main compile try block for one bounded retry. */
export interface PreviewMissingDependencyAcquisitionContext {
  readonly environment: PreviewManagedDependencyEnvironment;
  readonly projectRoot: string;
  readonly readSource?: (sourcePath: string) => Promise<string | undefined> | string | undefined;
  readonly reportAcquisition?: () => void;
  readonly targetPath: string;
  readonly workspaceRoot: string;
}

/** One package connection ranked after manifest and lock evidence admitted it. */
export interface PreviewDependencyPackageHint {
  readonly family: 'core' | 'general' | 'server' | 'ui';
  readonly packageName: string;
  readonly score: PreviewDependencyResolutionNeuralScore;
}

/** One exact explicit server source selected as a render-only execution-contract boundary. */
export interface PreviewDependencyServerFacadeHint {
  readonly sourcePath: string;
  readonly score: PreviewDependencyResolutionNeuralScore;
}

/** One exact server-affinity package edge eligible for a neutral browser execution contract. */
export interface PreviewDependencyPackageContractHint {
  readonly moduleSpecifier: string;
  readonly packageName: string;
  readonly score: PreviewDependencyResolutionNeuralScore;
  readonly sourcePath: string;
}

/** One exact authored style edge eligible for a fail-soft render-only stylesheet contract. */
export interface PreviewDependencyStyleContractHint {
  readonly moduleSpecifier: string;
  readonly packageName: string;
  readonly score: PreviewDependencyResolutionNeuralScore;
  readonly sourcePath: string;
}

/** Immutable compiler retry hints; no project bytes or generated values cross this boundary. */
export interface PreviewDependencyResolutionHintPlan {
  readonly facadeCandidates: readonly PreviewDependencyServerFacadeHint[];
  readonly facadeSourcePaths: readonly string[];
  readonly packageCandidates: readonly PreviewDependencyPackageHint[];
  readonly packageContractCandidates: readonly PreviewDependencyPackageContractHint[];
  readonly packageNames: readonly string[];
  readonly styleCandidates: readonly PreviewDependencyStyleContractHint[];
  readonly version: 3;
}

/** Keeps only non-acquiring contracts for a speculative first-build preflight. */
export function createPreviewRenderOnlyDependencyResolutionHintPlan(
  plan: PreviewDependencyResolutionHintPlan,
): PreviewDependencyResolutionHintPlan {
  return Object.freeze({
    ...plan,
    packageCandidates: Object.freeze([]),
    packageNames: Object.freeze([]),
  });
}

/** Merges exact retry-scoped evidence without allowing duplicate plugin contracts. */
export function mergePreviewDependencyResolutionHintPlans(
  left: PreviewDependencyResolutionHintPlan | undefined,
  right: PreviewDependencyResolutionHintPlan,
): PreviewDependencyResolutionHintPlan {
  if (left === undefined) return right;
  const unique = <T>(values: readonly T[], identity: (value: T) => string): readonly T[] =>
    Object.freeze(
      values.filter(
        (value, index) =>
          values.findIndex((candidate) => identity(candidate) === identity(value)) === index,
      ),
    );
  const facadeCandidates = unique(
    [...left.facadeCandidates, ...right.facadeCandidates],
    (candidate) => path.normalize(candidate.sourcePath),
  );
  return Object.freeze({
    facadeCandidates,
    facadeSourcePaths: Object.freeze(
      [...new Set(facadeCandidates.map((candidate) => candidate.sourcePath))].sort(),
    ),
    packageCandidates: unique(
      [...left.packageCandidates, ...right.packageCandidates],
      (candidate) => candidate.packageName,
    ),
    packageContractCandidates: unique(
      [...left.packageContractCandidates, ...right.packageContractCandidates],
      (candidate) => `${path.normalize(candidate.sourcePath)}\0${candidate.moduleSpecifier}`,
    ),
    packageNames: Object.freeze([...new Set([...left.packageNames, ...right.packageNames])].sort()),
    styleCandidates: unique(
      [...left.styleCandidates, ...right.styleCandidates],
      (candidate) => `${path.normalize(candidate.sourcePath)}\0${candidate.moduleSpecifier}`,
    ),
    version: 3,
  });
}

/** Parameters needed to turn one build failure into a verified store acquisition attempt. */
export interface PreviewMissingDependencyAcquisitionOptions {
  readonly context: PreviewMissingDependencyAcquisitionContext | undefined;
  readonly errors: readonly Message[];
  readonly neuralModel?: PreviewDependencyResolutionNeuralModel;
  readonly signal: AbortSignal;
  readonly store:
    Pick<PreviewManagedDependencyStore, 'acquireLockedDependencies' | 'prepare'> | undefined;
}

/** Inputs for a syntax-only missing-package probe over the already admitted Inspector frontier. */
export interface PreviewDependencyResolutionPreflightOptions {
  readonly readSource: (sourcePath: string) => Promise<string | undefined> | string | undefined;
  readonly resolveModule: (moduleSpecifier: string, importerPath: string) => string | undefined;
  readonly sourcePaths: readonly string[];
}

/**
 * Finds exact unresolved package edges before native bundling starts.
 *
 * The frontier already bounded these sources and the normal static resolver still has authority:
 * this function neither invents imports nor applies a fallback. It only shapes resolver misses like
 * esbuild diagnostics so the same deterministic admission and neural ranking path can decide
 * whether a render-only contract is safe to apply on the first native build.
 */
export async function collectPreviewDependencyResolutionPreflightMessages(
  options: PreviewDependencyResolutionPreflightOptions,
): Promise<readonly Message[]> {
  const messages: Message[] = [];
  const seen = new Set<string>();
  for (const sourcePath of options.sourcePaths) {
    const sourceText = await options.readSource(sourcePath);
    if (
      sourceText === undefined ||
      Buffer.byteLength(sourceText, 'utf8') > MAXIMUM_HINT_SOURCE_BYTES
    )
      continue;
    const parsedCssImports = STYLE_SOURCE_PATTERN.test(sourcePath)
      ? parsePreviewCssImports(sourceText)
      : undefined;
    const moduleSpecifiers = [
      ...collectPreviewInspectorRuntimeImportInventory(sourcePath, sourceText).map(
        (edge) => edge.moduleSpecifier,
      ),
      ...(parsedCssImports?.unsafeReason === undefined
        ? (parsedCssImports?.imports.map((cssImport) => cssImport.specifier) ?? [])
        : []),
    ];
    for (const moduleSpecifier of moduleSpecifiers) {
      const packageName = readPackageRoot(moduleSpecifier);
      if (
        packageName === undefined ||
        NODE_BUILTIN_NAMES.has(packageName) ||
        options.resolveModule(moduleSpecifier, sourcePath) !== undefined
      ) {
        continue;
      }
      const identity = `${path.normalize(sourcePath)}\0${moduleSpecifier}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      messages.push({
        detail: undefined,
        id: '',
        location: {
          column: 0,
          file: path.normalize(sourcePath),
          length: moduleSpecifier.length,
          line: 1,
          lineText: '',
          namespace: 'file',
          suggestion: '',
        },
        notes: [],
        pluginName: 'react-preview-dependency-preflight',
        text: `Could not resolve "${moduleSpecifier}"`,
      });
    }
  }
  return Object.freeze(messages);
}

/**
 * Finds exact declared package roots that may be restored from the project's lockfile.
 *
 * @param messages Esbuild failures produced after normal local and managed resolution both miss.
 * @param profile Active dependency profile whose declarations bound supply-chain acquisition.
 * @returns Stable, deduplicated npm package roots suitable for one lockfile acquisition batch.
 */
export function collectPreviewMissingDependencyRequirements(
  messages: readonly Message[],
  profile: PreviewDependencyProfile | undefined,
): readonly string[] {
  if (profile?.hasReusableLockEvidence !== true) return Object.freeze([]);
  return collectPreviewDeclaredDependencyRequirements(messages, profile);
}

/** Collects manifest-proven package edges without granting permission to acquire their archives. */
function collectPreviewDeclaredDependencyRequirements(
  messages: readonly Message[],
  profile: PreviewDependencyProfile | undefined,
): readonly string[] {
  if (profile === undefined) return Object.freeze([]);
  const packageNames = new Set<string>();
  for (const message of messages) {
    const unresolved = readPreviewUnresolvedPackage(message);
    const moduleSpecifier = unresolved?.moduleSpecifier;
    const packageName = unresolved?.packageName;
    const dependencySpecifier =
      packageName === undefined || moduleSpecifier === undefined
        ? undefined
        : (findPreviewDependencySpecifier(profile, packageName) ??
          findExactReactDomCompanionSpecifier(moduleSpecifier, packageName, profile));
    if (
      packageName === undefined ||
      NODE_BUILTIN_NAMES.has(packageName) ||
      dependencySpecifier === undefined ||
      !isRegistryDependencySpecifier(dependencySpecifier)
    ) {
      continue;
    }
    packageNames.add(packageName);
  }
  return Object.freeze([...packageNames].sort());
}

/**
 * Reads one safe npm package identity from an exact esbuild unresolved-module diagnostic.
 */
export function readPreviewUnresolvedPackage(
  message: Message,
): { readonly moduleSpecifier: string; readonly packageName: string } | undefined {
  const moduleSpecifier = UNRESOLVED_PACKAGE_PATTERN.exec(message.text.trim())?.[1];
  if (moduleSpecifier === undefined || !isSafeBareSpecifier(moduleSpecifier)) return undefined;
  const packageName = readPackageRoot(moduleSpecifier);
  return packageName === undefined || NODE_BUILTIN_NAMES.has(packageName)
    ? undefined
    : Object.freeze({ moduleSpecifier, packageName });
}

/**
 * Admits React DOM's exact package root only when direct React and reusable lock evidence can
 * identify a matching companion record. Keeping this check on the raw module request prevents the
 * narrow exception from silently widening to arbitrary `react-dom/*` entry points.
 */
function findExactReactDomCompanionSpecifier(
  moduleSpecifier: string,
  packageName: string,
  profile: PreviewDependencyProfile,
): string | undefined {
  return moduleSpecifier === 'react-dom' && packageName === 'react-dom'
    ? findPreviewReactDomCompanionSpecifier(profile)
    : undefined;
}

/**
 * Builds neural recovery hints, restores the UI/runtime package closure in bounded batches, and
 * returns the exact plan that a single compiler retry may apply.
 */
export async function tryAcquirePreviewMissingDependencies(
  options: PreviewMissingDependencyAcquisitionOptions,
): Promise<PreviewDependencyResolutionHintPlan | undefined> {
  const context = options.context;
  if (context === undefined) return undefined;
  const neuralModel = options.neuralModel ?? new PreviewDependencyResolutionNeuralModel();
  const plan = await createPreviewDependencyResolutionHintPlan(
    options.errors,
    context,
    neuralModel,
  );
  if (
    plan.facadeSourcePaths.length === 0 &&
    plan.packageNames.length === 0 &&
    plan.packageContractCandidates.length === 0 &&
    plan.styleCandidates.length === 0
  ) {
    return undefined;
  }

  let environmentChanged = false;
  if (plan.packageCandidates.length > 0 && options.store !== undefined) {
    context.reportAcquisition?.();
    const acquired = await acquireRankedPackageHints(
      plan.packageCandidates,
      { ...options, context, store: options.store },
      neuralModel,
    );
    if (acquired) {
      const refreshedEnvironment = await options.store.prepare(
        context.projectRoot,
        context.workspaceRoot,
      );
      environmentChanged = refreshedEnvironment.identity !== context.environment.identity;
    }
  }
  return plan.facadeSourcePaths.length > 0 ||
    plan.packageContractCandidates.length > 0 ||
    plan.styleCandidates.length > 0 ||
    environmentChanged
    ? plan
    : undefined;
}

/** Produces a safe plan in which the model ranks, but never invents, recovery actions. */
export async function createPreviewDependencyResolutionHintPlan(
  errors: readonly Message[],
  context: PreviewMissingDependencyAcquisitionContext,
  neuralModel = new PreviewDependencyResolutionNeuralModel(),
): Promise<PreviewDependencyResolutionHintPlan> {
  const messagesBySource = groupMissingMessagesBySource(errors, context.workspaceRoot);
  const facadeCandidates: PreviewDependencyServerFacadeHint[] = [];
  const facadedMessages = new Set<Message>();
  for (const [sourcePath, sourceMessages] of messagesBySource) {
    if (samePath(sourcePath, context.targetPath)) continue;
    const sourceText = await readRecoverySource(sourcePath, context.readSource);
    if (sourceText === undefined || !hasExplicitPreviewServerBoundary(sourceText)) continue;
    const packages = collectPreviewDeclaredDependencyRequirements(
      sourceMessages,
      context.environment.profile,
    );
    const features = createNeuralFeatures({
      declaredPackageRatio:
        sourceMessages.length === 0 ? 0 : packages.length / sourceMessages.length,
      errorCount: sourceMessages.length,
      packageNames: sourceMessages.flatMap((message) => {
        const packageName = readPreviewUnresolvedPackage(message)?.packageName;
        return packageName === undefined ? [] : [packageName];
      }),
      sourcePath,
      sourceText,
      targetModule: false,
    });
    const facadeScore = neuralModel.score(
      'facade-server-contract',
      features,
      sourceText.includes('server-only') ? 0.99 : 0.96,
    );
    const packageScore = neuralModel.score(
      'acquire-package',
      features,
      features.packageServerAffinity > 0 ? 0.42 : 0.7,
    );
    if (facadeScore.selectionScore < packageScore.selectionScore + 0.04) continue;
    facadeCandidates.push(Object.freeze({ score: facadeScore, sourcePath }));
    for (const message of sourceMessages) facadedMessages.add(message);
  }
  facadeCandidates.sort(
    (left, right) =>
      right.score.selectionScore - left.score.selectionScore ||
      left.sourcePath.localeCompare(right.sourcePath),
  );

  const packageMessages = errors.filter((message) => !facadedMessages.has(message));
  const packageNames = collectPreviewMissingDependencyRequirements(
    packageMessages,
    context.environment.profile,
  );
  const acquirablePackageNames = new Set(packageNames);
  const declaredPackageNames = collectPreviewDeclaredDependencyRequirements(
    packageMessages,
    context.environment.profile,
  );
  const admittedPackageNames = new Set(declaredPackageNames);
  const styleCandidateKeys = new Set<string>();
  const styleContractMessages = new Set<Message>();
  const styleCandidates = packageMessages.flatMap((message) => {
    const unresolved = readPreviewUnresolvedPackage(message);
    const sourcePath = readMessageSourcePath(message, context.workspaceRoot);
    if (
      unresolved === undefined ||
      sourcePath === undefined ||
      !admittedPackageNames.has(unresolved.packageName) ||
      (!STYLE_SOURCE_PATTERN.test(sourcePath) &&
        !STYLE_MODULE_PATTERN.test(unresolved.moduleSpecifier))
    ) {
      return [];
    }
    const candidateKey = `${sourcePath}\0${unresolved.moduleSpecifier}`;
    if (styleCandidateKeys.has(candidateKey)) {
      styleContractMessages.add(message);
      return [];
    }
    const features = createNeuralFeatures({
      declaredPackageRatio: 1,
      errorCount: 1,
      packageNames: [unresolved.packageName],
      sourcePath,
      sourceText: '',
      styleConsumer: true,
      targetModule: samePath(sourcePath, context.targetPath),
    });
    const styleScore = neuralModel.score(
      'facade-style-contract',
      features,
      STYLE_SOURCE_PATTERN.test(sourcePath) ? 0.99 : 0.95,
    );
    if (acquirablePackageNames.has(unresolved.packageName)) {
      const acquisitionScore = neuralModel.score(
        'acquire-package',
        features,
        selectPackageAcquisitionConfidence(unresolved.packageName),
      );
      if (styleScore.selectionScore < acquisitionScore.selectionScore + 0.04) return [];
    }
    styleCandidateKeys.add(candidateKey);
    styleContractMessages.add(message);
    return [
      Object.freeze({
        moduleSpecifier: unresolved.moduleSpecifier,
        packageName: unresolved.packageName,
        score: styleScore,
        sourcePath,
      }),
    ];
  });
  styleCandidates.sort(
    (left, right) =>
      right.score.selectionScore - left.score.selectionScore ||
      left.sourcePath.localeCompare(right.sourcePath) ||
      left.moduleSpecifier.localeCompare(right.moduleSpecifier),
  );
  const packageContractCandidates: PreviewDependencyPackageContractHint[] = [];
  const packageContractKeys = new Set<string>();
  const packageContractMessages = new Set<Message>();
  for (const message of packageMessages) {
    const unresolved = readPreviewUnresolvedPackage(message);
    const sourcePath = readMessageSourcePath(message, context.workspaceRoot);
    if (
      unresolved === undefined ||
      sourcePath === undefined ||
      styleContractMessages.has(message) ||
      !admittedPackageNames.has(unresolved.packageName)
    ) {
      continue;
    }
    const candidateKey = `${sourcePath}\0${unresolved.moduleSpecifier}`;
    if (packageContractKeys.has(candidateKey)) {
      packageContractMessages.add(message);
      continue;
    }
    const sourceText = (await readRecoverySource(sourcePath, context.readSource)) ?? '';
    const contractEvidence = selectServerPackageContractEvidence({
      packageName: unresolved.packageName,
      sourcePath,
      sourceText,
      targetModule: samePath(sourcePath, context.targetPath),
    });
    if (contractEvidence === undefined) continue;
    const features = createNeuralFeatures({
      declaredPackageRatio: 1,
      errorCount: 1,
      packageNames: [unresolved.packageName],
      serverSourceAffinity: contractEvidence.sourceAffinity,
      sourcePath,
      sourceText,
      targetModule: samePath(sourcePath, context.targetPath),
    });
    const contractScore = neuralModel.score(
      'facade-package-contract',
      features,
      contractEvidence.deterministicConfidence,
    );
    if (acquirablePackageNames.has(unresolved.packageName)) {
      const acquisitionScore = neuralModel.score(
        'acquire-package',
        features,
        selectPackageAcquisitionConfidence(unresolved.packageName),
      );
      if (contractScore.selectionScore < acquisitionScore.selectionScore + 0.04) continue;
    }
    packageContractKeys.add(candidateKey);
    packageContractMessages.add(message);
    packageContractCandidates.push(
      Object.freeze({
        moduleSpecifier: unresolved.moduleSpecifier,
        packageName: unresolved.packageName,
        score: contractScore,
        sourcePath,
      }),
    );
  }
  packageContractCandidates.sort(
    (left, right) =>
      right.score.selectionScore - left.score.selectionScore ||
      left.sourcePath.localeCompare(right.sourcePath) ||
      left.moduleSpecifier.localeCompare(right.moduleSpecifier),
  );

  // Style and server contracts are tried only after ordinary resolution on the rebuild. Keeping
  // their already-covered roots out of archive acquisition prevents oversized fonts or server SDK
  // closures from consuming the worker watchdog before the deterministic fallback can cooperate.
  const acquisitionPackageNames = packageNames.filter((packageName) => {
    const matchingMessages = packageMessages.filter(
      (message) => readPreviewUnresolvedPackage(message)?.packageName === packageName,
    );
    return matchingMessages.some(
      (message) => !styleContractMessages.has(message) && !packageContractMessages.has(message),
    );
  });
  const packageCandidates = acquisitionPackageNames.map((packageName) => {
    const matchingMessages = packageMessages.filter(
      (message) => readPreviewUnresolvedPackage(message)?.packageName === packageName,
    );
    const sourcePaths = matchingMessages
      .map((message) => readMessageSourcePath(message, context.workspaceRoot))
      .filter((sourcePath): sourcePath is string => sourcePath !== undefined);
    const jsxSourcePath = sourcePaths.find((sourcePath) => /x$/iu.test(sourcePath));
    const features = createNeuralFeatures({
      declaredPackageRatio: 1,
      errorCount: matchingMessages.length,
      packageNames: [packageName],
      ...(jsxSourcePath === undefined ? {} : { sourcePath: jsxSourcePath }),
      sourceText: '',
      targetModule: sourcePaths.some((sourcePath) => samePath(sourcePath, context.targetPath)),
    });
    return Object.freeze({
      family: selectPackageHintFamily(packageName),
      packageName,
      score: neuralModel.score(
        'acquire-package',
        features,
        selectPackageAcquisitionConfidence(packageName),
      ),
    });
  });
  packageCandidates.sort(
    (left, right) =>
      right.score.selectionScore - left.score.selectionScore ||
      left.packageName.localeCompare(right.packageName),
  );
  return Object.freeze({
    facadeCandidates: Object.freeze(facadeCandidates),
    facadeSourcePaths: Object.freeze(
      facadeCandidates.map((candidate) => candidate.sourcePath).sort(),
    ),
    packageCandidates: Object.freeze(packageCandidates),
    packageContractCandidates: Object.freeze(packageContractCandidates),
    packageNames: Object.freeze(packageCandidates.map((candidate) => candidate.packageName)),
    styleCandidates: Object.freeze(styleCandidates),
    version: 3 as const,
  });
}

/** Acquires neural-prioritized package clusters without turning one failure into a retry storm. */
async function acquireRankedPackageHints(
  candidates: readonly PreviewDependencyPackageHint[],
  options: PreviewMissingDependencyAcquisitionOptions & {
    readonly context: PreviewMissingDependencyAcquisitionContext;
    readonly store: Pick<PreviewManagedDependencyStore, 'acquireLockedDependencies' | 'prepare'>;
  },
  neuralModel: PreviewDependencyResolutionNeuralModel,
): Promise<boolean> {
  let acquiredAny = false;
  const browserCandidates = candidates.filter((candidate) => candidate.family !== 'server');
  const serverCandidates = candidates.filter((candidate) => candidate.family === 'server');
  let attempts = 0;
  const acquireBatch = async (
    batch: readonly PreviewDependencyPackageHint[],
    splitLargeFailure: boolean,
    splittingActive = false,
  ): Promise<boolean> => {
    if (batch.length === 0 || attempts >= MAXIMUM_ACQUISITION_BATCH_ATTEMPTS) return false;
    attempts += 1;
    let acquired = false;
    try {
      acquired = await options.store.acquireLockedDependencies({
        profile: options.context.environment.profile,
        projectRoot: options.context.projectRoot,
        requiredPackageNames: batch.map((candidate) => candidate.packageName),
        signal: options.signal,
      });
      for (const candidate of batch) {
        neuralModel.recordOutcome(candidate.score, acquired, acquired ? 1 : 0.25);
      }
      acquiredAny ||= acquired;
    } catch (error) {
      if (options.signal.aborted) throw error;
      for (const candidate of batch) neuralModel.recordOutcome(candidate.score, false, 0.25);
    }
    if (
      acquired ||
      !splitLargeFailure ||
      (!splittingActive && batch.length < MINIMUM_ACQUISITION_SPLIT_SIZE) ||
      batch.length === 1 ||
      attempts >= MAXIMUM_ACQUISITION_BATCH_ATTEMPTS
    ) {
      return acquired;
    }
    const middle = Math.ceil(batch.length / 2);
    const leftAcquired = await acquireBatch(batch.slice(0, middle), true, true);
    const rightAcquired = await acquireBatch(batch.slice(middle), true, true);
    return leftAcquired || rightAcquired;
  };
  for (const batch of createAcquisitionBatches(browserCandidates)) {
    const acquired = await acquireBatch(batch, true);
    acquiredAny = acquiredAny || acquired;
  }
  for (const batch of createAcquisitionBatches(serverCandidates)) {
    const acquired = await acquireBatch(batch, false);
    acquiredAny = acquiredAny || acquired;
  }
  return acquiredAny;
}

/** Partitions ranked package hints into bounded lockfile acquisition requests. */
function createAcquisitionBatches(
  candidates: readonly PreviewDependencyPackageHint[],
): readonly (readonly PreviewDependencyPackageHint[])[] {
  return Array.from(
    { length: Math.ceil(candidates.length / MAXIMUM_PACKAGES_PER_ACQUISITION_BATCH) },
    (_, index) =>
      candidates.slice(
        index * MAXIMUM_PACKAGES_PER_ACQUISITION_BATCH,
        (index + 1) * MAXIMUM_PACKAGES_PER_ACQUISITION_BATCH,
      ),
  );
}

/** Groups only exact workspace source locations; virtual and package locations stay acquisition-only. */
function groupMissingMessagesBySource(
  errors: readonly Message[],
  workspaceRoot: string,
): ReadonlyMap<string, readonly Message[]> {
  const grouped = new Map<string, Message[]>();
  for (const message of errors) {
    if (readPreviewUnresolvedPackage(message) === undefined) continue;
    const sourcePath = readMessageSourcePath(message, workspaceRoot);
    if (sourcePath === undefined || !/\.[cm]?[jt]sx?$/iu.test(sourcePath)) continue;
    const messages = grouped.get(sourcePath) ?? [];
    messages.push(message);
    grouped.set(sourcePath, messages);
  }
  return grouped;
}

/** Resolves a diagnostic location only when it remains inside the active workspace. */
function readMessageSourcePath(message: Message, workspaceRoot: string): string | undefined {
  const file = message.location?.file;
  if (file === undefined || file.length === 0 || file.startsWith('react-preview-'))
    return undefined;
  const root = canonicalizeExistingPath(workspaceRoot);
  const candidate = canonicalizeExistingPath(
    path.isAbsolute(file) ? file : path.resolve(root, file),
  );
  const relativePath = path.relative(root, candidate);
  return relativePath.length === 0 ||
    (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
    ? candidate
    : undefined;
}

/** Reads one bounded source overlay or file for deterministic boundary evidence. */
async function readRecoverySource(
  sourcePath: string,
  readSource: PreviewMissingDependencyAcquisitionContext['readSource'],
): Promise<string | undefined> {
  try {
    const supplied = await readSource?.(sourcePath);
    if (supplied !== undefined) {
      return Buffer.byteLength(supplied, 'utf8') <= MAXIMUM_HINT_SOURCE_BYTES
        ? supplied
        : undefined;
    }
    const metadata = await stat(sourcePath);
    if (!metadata.isFile() || metadata.size > MAXIMUM_HINT_SOURCE_BYTES) return undefined;
    return await readFile(sourcePath, 'utf8');
  } catch {
    return undefined;
  }
}

/** Encodes semantic compiler evidence without retaining source text or package identities. */
function createNeuralFeatures(options: {
  readonly declaredPackageRatio: number;
  readonly errorCount: number;
  readonly packageNames: readonly string[];
  readonly serverSourceAffinity?: number;
  readonly sourcePath?: string;
  readonly sourceText: string;
  readonly styleConsumer?: boolean;
  readonly targetModule: boolean;
}): PreviewDependencyResolutionNeuralFeatures {
  const packageCount = Math.max(1, options.packageNames.length);
  const ratio = (pattern: RegExp): number =>
    options.packageNames.filter((packageName) => pattern.test(packageName)).length / packageCount;
  return Object.freeze({
    declaredPackageRatio: Math.min(1, Math.max(0, options.declaredPackageRatio)),
    errorDensity: Math.min(1, options.errorCount / 12),
    explicitServerBoundary: hasExplicitPreviewServerBoundary(options.sourceText) ? 1 : 0,
    frameworkRuntime: options.packageNames.some(
      (packageName) => packageName === 'next' || packageName.startsWith('next-'),
    )
      ? 1
      : 0,
    jsxConsumer: options.sourcePath !== undefined && /x$/iu.test(options.sourcePath) ? 1 : 0,
    packageCoreRuntime: ratio(CORE_RUNTIME_PACKAGE_PATTERN),
    packageServerAffinity: Math.max(
      ratio(SERVER_PACKAGE_PATTERN),
      Math.min(1, Math.max(0, options.serverSourceAffinity ?? 0)),
    ),
    packageUiAffinity: ratio(UI_PACKAGE_PATTERN),
    styleConsumer: options.styleConsumer === true ? 1 : 0,
    targetModule: options.targetModule ? 1 : 0,
    useServerDirective: /(?:^|\n)\s*["']use server["']\s*;?/u.test(options.sourceText) ? 1 : 0,
  });
}

/**
 * Separates a package-name prior from importer evidence so unknown server libraries can still be
 * considered without turning arbitrary missing UI packages into execution contracts.
 */
function selectServerPackageContractEvidence(options: {
  readonly packageName: string;
  readonly sourcePath: string;
  readonly sourceText: string;
  readonly targetModule: boolean;
}): { readonly deterministicConfidence: number; readonly sourceAffinity: number } | undefined {
  const explicitBoundary = hasExplicitPreviewServerBoundary(options.sourceText);
  const knownServerPackage = SERVER_PACKAGE_PATTERN.test(options.packageName);
  const serverRuntime = SERVER_RUNTIME_SOURCE_PATTERN.test(options.sourceText);
  const serverPath = SERVER_SOURCE_PATH_PATTERN.test(options.sourcePath);
  const nonVisualSupportModule = !options.targetModule && !/x$/iu.test(options.sourcePath);
  if (explicitBoundary) {
    return Object.freeze({ deterministicConfidence: 0.99, sourceAffinity: 1 });
  }
  if (knownServerPackage) {
    return Object.freeze({
      deterministicConfidence: serverRuntime ? 0.98 : 0.92,
      sourceAffinity: 1,
    });
  }
  if (!nonVisualSupportModule || (!serverRuntime && !serverPath)) return undefined;
  return Object.freeze({
    deterministicConfidence: serverRuntime && serverPath ? 0.94 : serverRuntime ? 0.88 : 0.82,
    sourceAffinity: serverRuntime && serverPath ? 0.92 : serverRuntime ? 0.78 : 0.65,
  });
}

/** Compares normalized host paths without requiring either path to exist. */
function samePath(left: string, right: string): boolean {
  return path.normalize(left) === path.normalize(right);
}

/** Selects the acquisition failure domain used for bounded retry isolation. */
function selectPackageHintFamily(packageName: string): PreviewDependencyPackageHint['family'] {
  if (CORE_RUNTIME_PACKAGE_PATTERN.test(packageName)) return 'core';
  if (UI_PACKAGE_PATTERN.test(packageName)) return 'ui';
  if (SERVER_PACKAGE_PATTERN.test(packageName)) return 'server';
  return 'general';
}

/** Supplies deterministic evidence strength that the model may refine but never bypass. */
function selectPackageAcquisitionConfidence(packageName: string): number {
  if (CORE_RUNTIME_PACKAGE_PATTERN.test(packageName)) return 1;
  if (UI_PACKAGE_PATTERN.test(packageName)) return 0.9;
  if (SERVER_PACKAGE_PATTERN.test(packageName)) return 0.58;
  return 0.76;
}

/** Admits registry ranges and strict npm aliases while rejecting every local or remote source URL. */
function isRegistryDependencySpecifier(dependencySpecifier: string): boolean {
  const normalizedSpecifier = dependencySpecifier.trim();
  const virtualRange = /^virtual:[a-f\d]{6,64}#npm:(.+)$/u.exec(normalizedSpecifier)?.[1];
  if (virtualRange !== undefined) return isRegistryRange(virtualRange);
  if (normalizedSpecifier.startsWith('npm:')) {
    return isStrictNpmAliasSpecifier(normalizedSpecifier.slice('npm:'.length));
  }
  return isRegistryRange(normalizedSpecifier);
}

/** Requires `npm:<real-name>@<range>` so aliases cannot smuggle another package protocol. */
function isStrictNpmAliasSpecifier(aliasReference: string): boolean {
  const scopeSlash = aliasReference.startsWith('@') ? aliasReference.indexOf('/') : -1;
  const delimiterIndex = aliasReference.indexOf('@', scopeSlash >= 0 ? scopeSlash + 1 : 0);
  if (delimiterIndex <= 0) return false;
  const packageName = aliasReference.slice(0, delimiterIndex);
  const range = aliasReference.slice(delimiterIndex + 1);
  return PACKAGE_ROOT_PATTERN.test(packageName) && isRegistryRange(range);
}

/** Accepts ordinary tags and semver syntax without accepting path, protocol, or fragment syntax. */
function isRegistryRange(range: string): boolean {
  return (
    range.length > 0 &&
    range.length <= 2048 &&
    range === range.trim() &&
    !range.startsWith('.') &&
    !range.startsWith('/') &&
    !/[\\/@\0\r\n?!#]/u.test(range) &&
    !/^[a-z][a-z\d+.-]*:/iu.test(range)
  );
}

/** Rejects every syntax that may denote source aliases, loader requests, or non-registry modules. */
function isSafeBareSpecifier(moduleSpecifier: string): boolean {
  return (
    moduleSpecifier.length > 0 &&
    !moduleSpecifier.startsWith('.') &&
    !moduleSpecifier.startsWith('/') &&
    !moduleSpecifier.startsWith('#') &&
    !moduleSpecifier.includes('\\') &&
    !/[\0\s?!#]/u.test(moduleSpecifier) &&
    !/^[a-z][a-z\d+.-]*:/iu.test(moduleSpecifier)
  );
}

/** Converts a package subpath to its npm root while requiring a complete scoped name. */
function readPackageRoot(moduleSpecifier: string): string | undefined {
  const segments = moduleSpecifier.split('/');
  const packageName = moduleSpecifier.startsWith('@')
    ? segments[0] !== undefined && segments[1] !== undefined
      ? `${segments[0]}/${segments[1]}`
      : undefined
    : segments[0];
  return packageName !== undefined && PACKAGE_ROOT_PATTERN.test(packageName)
    ? packageName
    : undefined;
}

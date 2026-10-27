/** Verifies campaign-owned process groups, browser cleanup, and row ownership evidence. */
import { stat } from 'node:fs/promises';
import { createConnection } from 'node:net';
import type { PreviewHeadlessOwnershipEvent } from './previewHeadlessRenderer';
import {
  PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY,
  type PreviewTsxCorpusCleanupProof,
  type PreviewTsxCorpusRowOwnershipEvent,
  type PreviewTsxCorpusStageEvent,
  type PreviewTsxCorpusWorkerResult,
} from './previewHeadlessTsxCorpusCampaignTypes';
import { isMissing } from './previewTsxCorpusFiles';
import type { LaneRowOutcome } from './previewTsxCorpusModel';
import { isPreviewLoopbackHost } from './previewLoopback';

/** Reports whether any required lane evidence stream exceeded its bounded capture budget. */
export function hasLaneCaptureTruncation(outcome: Pick<LaneRowOutcome, 'truncation'>): boolean {
  return outcome.truncation.stdout || outcome.truncation.stderr || outcome.truncation.stages;
}

/** Checks worker ownership records against their exact lane, generation, and command identities. */
export function ownershipTransportMatches(
  observed: readonly PreviewTsxCorpusRowOwnershipEvent[],
  captured: readonly PreviewTsxCorpusRowOwnershipEvent[],
): boolean {
  return (
    observed.length === captured.length &&
    observed.every((event, index) => JSON.stringify(event) === JSON.stringify(captured[index]))
  );
}

/** Requires explicit terminal browser, profile, and local-server cleanup evidence from the renderer result. */
export function confirmRendererCleanup(result: PreviewTsxCorpusWorkerResult): boolean {
  const cleanup = result.headless?.cleanup;
  return (
    cleanup !== undefined &&
    cleanup.browserTerminated &&
    cleanup.profileRemoved &&
    cleanup.serverClosed
  );
}

/** Correlates primary worker ownership telemetry with observed browser groups, profiles, and loopback ports. */
export async function inspectPrimaryOwnership(
  events: readonly PreviewTsxCorpusRowOwnershipEvent[],
  stages: readonly PreviewTsxCorpusStageEvent[],
): Promise<{
  readonly browserGroupAbsent: boolean;
  readonly cleanupFacts: Partial<PreviewTsxCorpusCleanupProof>;
  readonly profilePathAbsent: boolean;
  readonly sequenceValid: boolean;
  readonly serverPortClosed: boolean;
}> {
  const rendered = stages.some((event) => event.stage === 'render-started');
  if (!rendered) {
    return {
      browserGroupAbsent: events.length === 0,
      cleanupFacts: {
        ownershipEventCount: events.length,
        ownershipSequenceValid: events.length === 0,
      },
      profilePathAbsent: true,
      sequenceValid: events.length === 0,
      serverPortClosed: true,
    };
  }
  const ownership = events.map((event) => event.ownership);
  const expected: readonly PreviewHeadlessOwnershipEvent['kind'][] = [
    'profile-created',
    'server-listening',
    'browser-spawned',
    'browser-terminal',
    'server-closed',
    'profile-removed',
  ];
  const profileRoot =
    ownership[0]?.kind === 'profile-created' ? ownership[0].profileRoot : undefined;
  const server = ownership[1];
  const spawned = ownership[2];
  const sequenceValid =
    ownership.length === expected.length &&
    profileRoot !== undefined &&
    ownership.every(
      (event, position) => event.kind === expected[position] && event.profileRoot === profileRoot,
    ) &&
    server?.kind === 'server-listening' &&
    isPreviewLoopbackHost(server.loopbackHost) &&
    spawned?.kind === 'browser-spawned' &&
    typeof spawned.pgid === 'number' &&
    Number.isSafeInteger(spawned.pgid) &&
    spawned.pgid > 0;
  const browserPgid = spawned?.kind === 'browser-spawned' ? spawned.pgid : undefined;
  const loopbackPort = server?.kind === 'server-listening' ? server.loopbackPort : undefined;
  const loopbackHost = server?.kind === 'server-listening' ? server.loopbackHost : undefined;
  const browserGroupAbsent = sequenceValid && probePrimaryBrowserGroupAbsent(browserPgid);
  const profilePathAbsent = sequenceValid && (await pathIsAbsent(profileRoot));
  const serverPortClosed =
    sequenceValid &&
    loopbackPort !== undefined &&
    loopbackHost !== undefined &&
    (await loopbackPortIsClosed(loopbackPort, loopbackHost));
  return {
    browserGroupAbsent,
    cleanupFacts: {
      ...(browserPgid === undefined ? {} : { browserPgid, browserGroupAbsent }),
      ownershipEventCount: events.length,
      ownershipSequenceValid: sequenceValid,
      ...(profileRoot === undefined ? {} : { profileRoot, profilePathAbsent }),
      ...(loopbackPort === undefined ? {} : { serverLoopbackPort: loopbackPort, serverPortClosed }),
      ...(loopbackHost === undefined ? {} : { serverLoopbackHost: loopbackHost }),
    },
    profilePathAbsent,
    sequenceValid,
    serverPortClosed,
  };
}

/** Probes only a valid recorded browser process group and fails closed when absence cannot be established. */
export function probePrimaryBrowserGroupAbsent(pgid: number | undefined): boolean {
  if (pgid === undefined || process.platform === 'win32') return pgid !== undefined;
  try {
    process.kill(-pgid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

/** Confirms a recorded cleanup path is missing while preserving other filesystem failures as uncertainty. */
export async function pathIsAbsent(target: string): Promise<boolean> {
  try {
    await stat(target);
    return false;
  } catch (error) {
    return isMissing(error);
  }
}

/** Probes the recorded loopback listener with a bounded socket timeout and returns whether closure is proven. */
export async function loopbackPortIsClosed(port: number, host: string): Promise<boolean> {
  if (!isPreviewLoopbackHost(host) || !Number.isSafeInteger(port) || port < 1 || port > 65535)
    return false;
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (closed: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve(closed);
    };
    const timer = setTimeout(() => {
      finish(false);
    }, PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.cleanupGraceMs);
    timer.unref();
    socket.once('connect', () => {
      finish(false);
    });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      finish(error.code === 'ECONNREFUSED');
    });
  });
}

/** Combines process exit and stream-terminal evidence into the normal worker cleanup decision. */
export function confirmNormalWorkerCleanup(
  stages: readonly PreviewTsxCorpusStageEvent[],
  result: PreviewTsxCorpusWorkerResult | undefined,
): boolean {
  if (!stages.some((event) => event.stage === 'cleanup-finished')) return false;
  const cleanup = result?.headless?.cleanup;
  return cleanup === undefined
    ? true
    : cleanup.browserTerminated && cleanup.profileRemoved && cleanup.serverClosed;
}

/** Real generated entry bootstrap must correlate replacements independently of the retained DOM. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewHotReloadRuntimeSource } from '../../../src/adapters/esbuild/previewHotReloadRuntimeSource';
import { createPreviewInspectorRuntimeCorrelationSource } from '../../../src/adapters/esbuild/pageInspector/previewInspectorRuntimeCorrelationSource';

/** Shared host-owned coordinator state carried between cache-busted entry evaluations. */
interface SharedHotRuntime {
  /** Revision whose validated module import is currently being prepared. */
  activeReloadRevision?: number;
  /** Latest validated reload; it can advance while a previous import is still preparing. */
  latestReloadRequest?: { readonly revision: number; readonly token: string };
  /** Stable webview session identifier created by the production correlation generator. */
  runtimeSessionId?: string;
}

/** Entry-local values consumed by readiness, errors and Inspector diagnostic envelopes. */
interface EntryIdentity {
  /** Immutable artifact identity parsed from this entry's private import URL. */
  readonly artifactId?: string;
  /** Prepared entry revision, independent from the original mount element's dataset. */
  readonly entryRevision: number;
  /** Diagnostic envelope revision accepted by the current host and browser bridge. */
  readonly runtimeRevision: number;
  /** Stable session across replacements of this one webview. */
  readonly runtimeSessionId: string;
  /** Host token belonging to this entry, absent when no matching reload exists. */
  readonly token?: string;
}

/** Combines the actual generated entry bootstrap and diagnostic correlation, without project code. */
function createEntryReader(
  runtime: SharedHotRuntime,
  dataset: {
    readonly reactPreviewRuntimeRevision?: string;
    readonly reactPreviewRuntimeToken?: string;
  },
  artifactId: string,
): () => EntryIdentity {
  const source = createPreviewHotReloadRuntimeSource('');
  const prefix = source.slice(0, source.indexOf('/** Replaces one module-owned'));
  const correlation = createPreviewInspectorRuntimeCorrelationSource().replaceAll(
    'import.meta.url',
    JSON.stringify(
      `https://preview.invalid/entry-${'a'.repeat(64)}.js?reactPreviewArtifact=${artifactId}`,
    ),
  );
  const context = vm.createContext({ URL, mountNode: { dataset } });
  Reflect.set(context, Symbol.for('newdlops.react-file-preview.hot-runtime'), runtime);
  return vm.runInContext(
    `(() => {
    ${prefix}
    ${correlation}
    return () => ({ ...readPreviewInspectorRuntimeCorrelation(),
      entryRevision: previewEntryRevision, token: previewRuntimeToken });
  })()`,
    context,
  ) as () => EntryIdentity;
}

describe('retained document entry identity', () => {
  it('reports current diagnostics and readiness for every replacement of the same document', () => {
    const runtime: SharedHotRuntime = {};
    const dataset = { reactPreviewRuntimeRevision: '1', reactPreviewRuntimeToken: '1:initial' };
    const first = createEntryReader(runtime, dataset, '1111111111111111');
    expect(first()).toMatchObject({ entryRevision: 1, runtimeRevision: 1, token: '1:initial' });
    const previousEntries = [{ read: first, identity: first() }];
    for (const revision of [2, 3, 4, 12]) {
      runtime.activeReloadRevision = revision;
      runtime.latestReloadRequest = { revision, token: `${String(revision)}:replacement` };
      const read = createEntryReader(runtime, dataset, '2222222222222222');
      expect(read()).toMatchObject({
        entryRevision: revision,
        runtimeRevision: revision,
        token: `${String(revision)}:replacement`,
        artifactId: '2222222222222222',
        runtimeSessionId: first().runtimeSessionId,
      });
      // Mutating the shared coordinator must not relabel callbacks captured by older entries.
      for (const previous of previousEntries) expect(previous.read()).toEqual(previous.identity);
      previousEntries.push({ read, identity: read() });
      expect(dataset).toEqual({
        reactPreviewRuntimeRevision: '1',
        reactPreviewRuntimeToken: '1:initial',
      });
    }
  });

  it.each([
    { active: 4, request: { revision: 5, token: '5:queued' } },
    { active: 4, request: undefined },
    { active: 0, request: { revision: 1, token: '1:queued' } },
  ])('never borrows a stale mount or another queued request token: %j', ({ active, request }) => {
    const runtime: SharedHotRuntime = {
      activeReloadRevision: active,
      ...(request === undefined ? {} : { latestReloadRequest: request }),
    };
    const read = createEntryReader(
      runtime,
      {
        reactPreviewRuntimeRevision: '1',
        reactPreviewRuntimeToken: '1:initial',
      },
      '3333333333333333',
    );
    expect(read()).toMatchObject({ entryRevision: active, runtimeRevision: active });
    expect(read().token).toBeUndefined();
  });
});

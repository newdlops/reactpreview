/** Verifies stable, opaque Page Inspector runtime identity without loading project modules. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorRuntimeCorrelationSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRuntimeCorrelationSource';

/** Browser correlation returned by the generated source fixture. */
interface RuntimeCorrelation {
  readonly artifactId?: string;
  readonly runtimeRevision: number;
  readonly runtimeSessionId: string;
}

describe('Preview Inspector runtime correlation source', () => {
  /** Reuses one webview session while changing artifact and revision across hot-entry evaluation. */
  it('separates stable session identity from current generated artifact identity', () => {
    const hotRuntime: { runtimeSessionId?: string } = {};
    const first = evaluateCorrelation(
      hotRuntime,
      'https://preview.local/entry-aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899.js',
      2,
    );
    const second = evaluateCorrelation(
      hotRuntime,
      'https://preview.local/entry-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff.js?reactPreviewArtifact=0123456789abcdef&reactPreviewRevision=3',
      3,
    );

    expect(first.runtimeSessionId).toMatch(/^rp-[0-9a-f]{24}$/u);
    expect(second.runtimeSessionId).toBe(first.runtimeSessionId);
    expect(first).toMatchObject({ artifactId: 'aabbccddeeff0011', runtimeRevision: 2 });
    expect(second).toMatchObject({ artifactId: '0123456789abcdef', runtimeRevision: 3 });
  });
});

/** Evaluates one cache-busted entry source with a shared webview-owned hot runtime. */
function evaluateCorrelation(
  previewHotRuntime: { runtimeSessionId?: string },
  entryUrl: string,
  revision: number,
): RuntimeCorrelation {
  const generatedSource = createPreviewInspectorRuntimeCorrelationSource().replaceAll(
    'import.meta.url',
    JSON.stringify(entryUrl),
  );
  return vm.runInNewContext(
    `(() => {
      const previewHotRuntime = globalThis.__hotRuntime;
      const previewEntryRevision = ${revision.toString()};
      const previewRuntimeRevision = ${revision.toString()};
      ${generatedSource}
      return readPreviewInspectorRuntimeCorrelation();
    })()`,
    { __hotRuntime: previewHotRuntime, URL },
  ) as RuntimeCorrelation;
}

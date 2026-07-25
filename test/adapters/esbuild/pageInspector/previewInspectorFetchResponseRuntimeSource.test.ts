/**
 * Verifies Fetch response serialization independently from the larger Page Inspector data registry.
 */
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorFetchResponseRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorFetchResponseRuntimeSource';

/** Executes the generated response helper with a small Response-compatible test double. */
async function createRuntimeResult(
  responseBodyKind: 'json' | 'text',
  url: string,
): Promise<{ contentType: string | null; json: unknown; text: string }> {
  const context: {
    result?: Promise<{ contentType: string | null; json: unknown; text: string }>;
  } = {};
  runInNewContext(
    [
      createPreviewInspectorFetchResponseRuntimeSource(),
      `const response = createPreviewInspectorFetchResponse(`,
      `  { title: 'Document', active: true }, 'GET', 200,`,
      `  ${JSON.stringify(responseBodyKind)}, ${JSON.stringify(url)},`,
      `);`,
      `globalThis.result = Promise.all([response.text(), response.json()]).then(([text, json]) => ({`,
      `  contentType: response.headers.get('content-type'), json, text,`,
      `}));`,
    ].join('\n'),
    context,
  );
  if (context.result === undefined) throw new Error('Generated Fetch response did not execute.');
  return context.result;
}

describe('createPreviewInspectorFetchResponseRuntimeSource', () => {
  /** Supplies valid HTML for iframe/rich-text consumers while retaining the generated payload. */
  it('wraps compiler-proven text payloads in an escaped preview document', async () => {
    const result = await createRuntimeResult('text', '/document/html?id=preview');

    expect(result.contentType).toContain('text/html');
    expect(result.text).toContain('<!doctype html>');
    expect(result.text).toContain('Generated preview document');
    expect(result.text).toContain('&quot;title&quot;');
    expect(result.json).toEqual({ active: true, title: 'Document' });
  });

  /** Leaves ordinary API responses JSON-shaped for existing `response.json()` consumers. */
  it('preserves JSON response semantics', async () => {
    const result = await createRuntimeResult('json', '/api/document');

    expect(result.contentType).toContain('application/json');
    expect(JSON.parse(result.text)).toEqual({ active: true, title: 'Document' });
    expect(result.json).toEqual({ active: true, title: 'Document' });
  });
});

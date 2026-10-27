/** Keeps authored parameter constraints inert while rejecting path escapes outside their tokens. */
import { describe, expect, it } from 'vitest';
import { readPreviewInspectorRouteSelectionRequest } from '../../src/presentation/previewInspectorRouteSelectionProtocol';

/** Builds a current bounded route envelope without normalizing its public source identity. */
function request(pattern: string): Record<string, unknown> {
  return {
    branchId: 'route-0123456789abcdef0123',
    interactionId: 'route:12:1',
    runtimeRevision: 12,
    selectionPath: [{ componentName: 'DocumentPage', pattern }],
    type: 'react-preview-inspector-route-selected',
  };
}

describe('Inspector route selection pattern boundary', () => {
  it.each([
    String.raw`/company/:companyId(\d+)`,
    String.raw`/company/:companyId(\d+)/document/:documentId(\d+)`,
    String.raw`/file/:name(\w+\.csv)`,
    String.raw`/item/:name(foo\(bar\))`,
  ])('retains the exact constrained route identity %s', (pattern) => {
    const parsed = readPreviewInspectorRouteSelectionRequest(request(pattern));
    expect(parsed?.selectionPath).toEqual([{ componentName: 'DocumentPage', pattern }]);
    expect(Object.isFrozen(parsed?.selectionPath)).toBe(true);
    expect(Object.isFrozen(parsed?.selectionPath[0])).toBe(true);
  });

  it.each([
    String.raw`/company\other/:id(\d+)`,
    String.raw`/\other/:id(\d+)`,
    String.raw`//other/:id(\d+)`,
    String.raw`/company/:id(\d+`,
    String.raw`/company/:id(\d+)\other`,
    String.raw`/company/:id(\d+)?query=1`,
    String.raw`/company/:id(\d+)#fragment`,
    '/company/:id(\\d+)\u0000',
    'https://example.com/:id(\\d+)',
  ])('rejects an unsafe or unscoped pattern %j', (pattern) => {
    expect(readPreviewInspectorRouteSelectionRequest(request(pattern))).toBeUndefined();
  });
});

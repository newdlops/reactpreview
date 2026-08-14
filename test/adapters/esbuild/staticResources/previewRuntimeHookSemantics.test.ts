/** Verifies render-safe semantic scalar defaults shared by hook and prop inference. */
import { describe, expect, it } from 'vitest';
import { inferPreviewRuntimeSemanticFallback } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookSemantics';

describe('inferPreviewRuntimeSemanticFallback', () => {
  /** Lets authored avatar fallbacks render without issuing a fabricated relative asset request. */
  it('keeps optional image-source fields network inert', () => {
    expect(inferPreviewRuntimeSemanticFallback('avatarUrl')).toMatchObject({
      expression: '""',
      kind: 'string',
      value: '',
    });
    expect(inferPreviewRuntimeSemanticFallback('thumbnailSrc')).toMatchObject({
      expression: '""',
      kind: 'string',
      value: '',
    });
  });

  /** Keeps generated destinations parseable and inert instead of echoing an invalid field name. */
  it('uses safe locations for non-image URL and path fields', () => {
    expect(inferPreviewRuntimeSemanticFallback('url')).toMatchObject({
      kind: 'string',
      value: 'https://example.invalid/',
    });
    expect(inferPreviewRuntimeSemanticFallback('pageNameOrUrl')).toMatchObject({
      kind: 'string',
      value: 'https://example.invalid/',
    });
    expect(inferPreviewRuntimeSemanticFallback('pathname')).toMatchObject({
      kind: 'string',
      value: '/',
    });
  });

  it('treats requirement flags as booleans', () => {
    expect(inferPreviewRuntimeSemanticFallback('requiresManagerConfirmation')).toMatchObject({
      expression: 'false',
      kind: 'boolean',
      value: false,
    });
  });

  /** Keeps one-based Wizard components on their first authored step instead of hiding all steps. */
  it('starts an inferred wizard step at one', () => {
    expect(inferPreviewRuntimeSemanticFallback('step')).toMatchObject({
      expression: '1',
      kind: 'number',
      value: 1,
    });
    expect(inferPreviewRuntimeSemanticFallback('stepCount')).toMatchObject({
      expression: '0',
      kind: 'number',
      value: 0,
    });
  });
});

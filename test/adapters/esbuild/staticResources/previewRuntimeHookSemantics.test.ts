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

  /** Retains ordinary navigation URL semantics for components that require a destination. */
  it('does not erase non-image URLs', () => {
    expect(inferPreviewRuntimeSemanticFallback('url')).toMatchObject({
      kind: 'string',
      value: 'url',
    });
  });
});

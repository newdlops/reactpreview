/** Verifies strict hot-reload acknowledgements and CSS-only entry cache invalidation. */
import { describe, expect, it } from 'vitest';
import {
  createHotReloadScriptUri,
  readPreviewHotReloadAcknowledgement,
} from '../../src/presentation/previewHotReloadProtocol';

describe('previewHotReloadProtocol', () => {
  /** Accepts only a ready acknowledgement that applied the exact requested revision. */
  it('parses an applied ready acknowledgement', () => {
    expect(
      readPreviewHotReloadAcknowledgement({
        applied: true,
        retainedPrevious: false,
        revision: 7,
        token: '7:artifact',
        type: 'react-preview-hot-reload-ready',
      }),
    ).toEqual({
      applied: true,
      retainedPrevious: false,
      revision: 7,
      token: '7:artifact',
      type: 'react-preview-hot-reload-ready',
    });
  });

  /** Preserves the explicit pre-commit failure state needed to retain the old artifact lease. */
  it('parses a failure that retained the previous tree', () => {
    expect(
      readPreviewHotReloadAcknowledgement({
        applied: false,
        retainedPrevious: true,
        revision: 8,
        token: '8:artifact',
        type: 'react-preview-hot-reload-failed',
      }),
    ).toMatchObject({ applied: false, retainedPrevious: true, revision: 8 });
  });

  /** Rejects ambiguous or contradictory messages before they can transfer a storage lease. */
  it.each([
    null,
    { applied: true, revision: 1, token: 'token', type: 'react-preview-hot-reload-ready' },
    {
      applied: false,
      retainedPrevious: false,
      revision: 1,
      token: 'token',
      type: 'react-preview-hot-reload-ready',
    },
    {
      applied: false,
      retainedPrevious: true,
      revision: -1,
      token: 'token',
      type: 'react-preview-hot-reload-failed',
    },
  ])('rejects invalid acknowledgement %#', (message) => {
    expect(readPreviewHotReloadAcknowledgement(message)).toBeUndefined();
  });

  /** Forces reevaluation even when JavaScript bytes stay stable and only stylesheet bytes changed. */
  it('adds revision and complete artifact identity to an immutable entry URL', () => {
    expect(
      createHotReloadScriptUri(
        'https://preview.test/session/entry-abc.js?discarded=1#fragment',
        12,
        'bundle-css-v2',
      ),
    ).toBe(
      'https://preview.test/session/entry-abc.js?reactPreviewRevision=12&reactPreviewArtifact=bundle-css-v2',
    );
  });
});

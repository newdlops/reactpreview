/**
 * Verifies the non-focusing Page Inspector tree-selection protocol before it reaches editor or
 * filesystem APIs. The protocol deliberately supports a path-free clear envelope while requiring
 * bounded runtime ordering for both clear and located selections.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isPreviewInspectorSourceSelectionMessage,
  readPreviewInspectorSourceSelectionRequest,
} from '../../src/presentation/previewInspectorProtocol';

const SOURCE_PATH = path.normalize('/workspace/src/Card.tsx');

describe('readPreviewInspectorSourceSelectionRequest', () => {
  /** Preserves exact and inferred source metadata used by the two editor decoration styles. */
  it('accepts bounded located selections', () => {
    const message = {
      approximate: true,
      column: 7,
      line: 3,
      occurrenceStart: 42,
      runtimeRevision: 9,
      sequence: 17,
      sourcePath: SOURCE_PATH,
      type: 'react-preview-inspector-source-selected',
    };

    expect(readPreviewInspectorSourceSelectionRequest(message)).toEqual(message);
  });

  /** A row without authored source clears a prior code mark without inventing a source path. */
  it('accepts an envelope-only clear selection', () => {
    expect(
      readPreviewInspectorSourceSelectionRequest({
        runtimeRevision: 9,
        sequence: 18,
        type: 'react-preview-inspector-source-selected',
      }),
    ).toEqual({
      runtimeRevision: 9,
      sequence: 18,
      type: 'react-preview-inspector-source-selected',
    });
  });

  /** Rejects ambiguous coordinates, unsupported paths, and unbounded ordering values. */
  it.each([
    {
      runtimeRevision: 1,
      sequence: 1,
      sourcePath: 'relative/Card.tsx',
      type: 'react-preview-inspector-source-selected',
    },
    {
      runtimeRevision: 1,
      sequence: 1,
      sourcePath: '/workspace/Card.css',
      type: 'react-preview-inspector-source-selected',
    },
    {
      column: 2,
      runtimeRevision: 1,
      sequence: 1,
      sourcePath: SOURCE_PATH,
      type: 'react-preview-inspector-source-selected',
    },
    {
      line: 0,
      runtimeRevision: 1,
      sequence: 1,
      sourcePath: SOURCE_PATH,
      type: 'react-preview-inspector-source-selected',
    },
    {
      approximate: true,
      runtimeRevision: 1,
      sequence: 1,
      type: 'react-preview-inspector-source-selected',
    },
    {
      runtimeRevision: -1,
      sequence: 1,
      type: 'react-preview-inspector-source-selected',
    },
    {
      runtimeRevision: 1,
      sequence: 0,
      type: 'react-preview-inspector-source-selected',
    },
    {
      runtimeRevision: 1,
      sequence: 10_000_001,
      type: 'react-preview-inspector-source-selected',
    },
  ])('rejects malformed source selection %#', (message) => {
    expect(readPreviewInspectorSourceSelectionRequest(message)).toBeUndefined();
  });

  /** Lets host routing consume a malformed claimed message without claiming unrelated traffic. */
  it('recognizes only the exact selection discriminator', () => {
    expect(
      isPreviewInspectorSourceSelectionMessage({
        sequence: 'bad',
        type: 'react-preview-inspector-source-selected',
      }),
    ).toBe(true);
    expect(isPreviewInspectorSourceSelectionMessage({ type: 'other' })).toBe(false);
  });
});

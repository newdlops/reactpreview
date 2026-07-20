/** Verifies the bounded two-webview protocol used by the separate React Inspector editor tab. */
import { describe, expect, it } from 'vitest';
import {
  isPreviewInspectorCompanionReady,
  isPreviewInspectorCompanionRevealRequest,
  readPreviewInspectorCompanionAction,
  readPreviewInspectorCompanionOpenSourceRequest,
  readPreviewInspectorCompanionSnapshot,
} from '../../src/presentation/previewInspectorCompanionProtocol';

describe('Preview Inspector companion protocol', () => {
  /** Accepts one monotonic inert UI document without mutating its structured-clone input. */
  it('parses a bounded preview snapshot', () => {
    const snapshot = readPreviewInspectorCompanionSnapshot({
      css: '.rpi-shell{display:grid}',
      html: '<aside class="rpi-shell"></aside>',
      sequence: 3,
      type: 'react-preview-inspector-companion-snapshot',
    });

    expect(snapshot).toEqual({
      css: '.rpi-shell{display:grid}',
      html: '<aside class="rpi-shell"></aside>',
      sequence: 3,
      type: 'react-preview-inspector-companion-snapshot',
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  /** Keeps explicit tree navigation distinct from ordinary snapshots that preserve local scroll. */
  it('accepts only bounded one-shot tree reveal intents', () => {
    expect(
      readPreviewInspectorCompanionSnapshot({
        css: '',
        html: '<aside></aside>',
        sequence: 4,
        treeReveal: 'fiber:root/target',
        type: 'react-preview-inspector-companion-snapshot',
      }),
    ).toMatchObject({ sequence: 4, treeReveal: 'fiber:root/target' });
    expect(
      readPreviewInspectorCompanionSnapshot({
        css: '',
        html: '<aside></aside>',
        sequence: 5,
        treeReveal: true,
        type: 'react-preview-inspector-companion-snapshot',
      }),
    ).toMatchObject({ sequence: 5, treeReveal: true });
    for (const treeReveal of [false, '', 'x'.repeat(16_385)]) {
      expect(
        readPreviewInspectorCompanionSnapshot({
          css: '',
          html: '<aside></aside>',
          sequence: 6,
          treeReveal,
          type: 'react-preview-inspector-companion-snapshot',
        }),
      ).toBeUndefined();
    }
  });

  /** Rejects malformed identities, unbounded values, and keyboard fields on non-key events. */
  it('bounds companion interactions before they reach the project runtime', () => {
    expect(
      readPreviewInspectorCompanionAction({
        eventType: 'input',
        remoteId: 'rpi-42',
        type: 'react-preview-inspector-companion-action',
        value: '{"enabled":true}',
      }),
    ).toEqual({
      eventType: 'input',
      remoteId: 'rpi-42',
      type: 'react-preview-inspector-companion-action',
      value: '{"enabled":true}',
    });
    expect(
      readPreviewInspectorCompanionAction({
        eventType: 'keydown',
        key: 'ArrowRight',
        remoteId: 'rpi-7',
        type: 'react-preview-inspector-companion-action',
      }),
    ).toMatchObject({ eventType: 'keydown', key: 'ArrowRight', remoteId: 'rpi-7' });
    for (const key of ['Home', 'End']) {
      expect(
        readPreviewInspectorCompanionAction({
          eventType: 'keydown',
          key,
          remoteId: 'rpi-8',
          type: 'react-preview-inspector-companion-action',
        }),
      ).toMatchObject({ eventType: 'keydown', key, remoteId: 'rpi-8' });
    }
    expect(
      readPreviewInspectorCompanionAction({
        eventType: 'keydown',
        key: 'PageDown',
        remoteId: 'rpi-8',
        type: 'react-preview-inspector-companion-action',
      }),
    ).toBeUndefined();
    expect(
      readPreviewInspectorCompanionAction({
        eventType: 'click',
        key: 'Enter',
        remoteId: 'rpi-1',
        type: 'react-preview-inspector-companion-action',
      }),
    ).toBeUndefined();
    expect(
      readPreviewInspectorCompanionAction({
        eventType: 'click',
        remoteId: '../../button',
        type: 'react-preview-inspector-companion-action',
      }),
    ).toBeUndefined();
    expect(
      readPreviewInspectorCompanionAction({
        eventType: 'input',
        remoteId: 'rpi-2',
        type: 'react-preview-inspector-companion-action',
        value: 'x'.repeat(2 * 1024 * 1024 + 1),
      }),
    ).toBeUndefined();
  });

  /** Recognizes only the exact readiness handshake used to replay a retained snapshot. */
  it('recognizes the companion readiness handshake', () => {
    expect(
      isPreviewInspectorCompanionReady({ type: 'react-preview-inspector-companion-ready' }),
    ).toBe(true);
    expect(isPreviewInspectorCompanionReady(null)).toBe(false);
    expect(isPreviewInspectorCompanionReady({ type: 'ready' })).toBe(false);
  });

  /** Accepts only the exact zero-payload renderer request used to focus the separate Inspector. */
  it('recognizes a wireframe-driven Inspector reveal request', () => {
    expect(
      isPreviewInspectorCompanionRevealRequest({
        type: 'react-preview-inspector-companion-reveal',
      }),
    ).toBe(true);
    expect(isPreviewInspectorCompanionRevealRequest({ type: 'reveal' })).toBe(false);
  });

  /** Bounds source metadata before the session later checks the committed dependency graph. */
  it('parses only absolute React source locations from companion clicks', () => {
    expect(
      readPreviewInspectorCompanionOpenSourceRequest({
        column: 4,
        line: 8,
        sourcePath: '/workspace/src/Target.tsx',
        type: 'react-preview-inspector-companion-open-source',
      }),
    ).toEqual({
      column: 4,
      line: 8,
      sourcePath: '/workspace/src/Target.tsx',
      type: 'react-preview-inspector-companion-open-source',
    });
    expect(
      readPreviewInspectorCompanionOpenSourceRequest({
        sourcePath: '../Target.tsx',
        type: 'react-preview-inspector-companion-open-source',
      }),
    ).toBeUndefined();
    expect(
      readPreviewInspectorCompanionOpenSourceRequest({
        column: 2,
        sourcePath: '/workspace/src/Target.tsx',
        type: 'react-preview-inspector-companion-open-source',
      }),
    ).toBeUndefined();
  });
});

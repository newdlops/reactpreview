import { describe, expect, it } from 'vitest';
import { PreviewPanelRouteSelection } from '../../src/presentation/previewPanelRouteSelection';
import type { ResolvedPreviewTarget } from '../../src/presentation/activePreviewTarget';

const target = { request: {} } as ResolvedPreviewTarget;
const first = [{ componentName: 'FeatureApp', pattern: '/feature/*' }] as const;
const second = [{ componentName: 'AboutPage', pattern: '/about' }] as const;

describe('PreviewPanelRouteSelection', () => {
  /** A literal root page is a selected path, not the empty automatic-selection reset. */
  it('keeps an explicit slash route across commit and distinguishes it from resetting selection', () => {
    const selection = new PreviewPanelRouteSelection();
    const root = [{ componentName: 'HomePage', pattern: '/' }] as const;
    expect(selection.begin(root)).toBe(true);
    expect(selection.applyTo(target).request.inspectorRouteSelection).toEqual(root);
    selection.commit();
    expect(selection.begin(root)).toBe(false);
    expect(selection.applyTo(target).request.inspectorRouteSelection).toEqual(root);
    expect(selection.begin([])).toBe(true);
    expect(selection.applyTo(target).request.inspectorRouteSelection).toBeUndefined();
    selection.rollback();
    expect(selection.applyTo(target).request.inspectorRouteSelection).toEqual(root);
  });

  it('uses a pending route for its build but keeps the committed route when that build fails', () => {
    const selection = new PreviewPanelRouteSelection();
    expect(selection.begin(first)).toBe(true);
    selection.commit();
    expect(selection.applyTo(target).request.inspectorRouteSelection).toEqual(first);
    expect(selection.applyTo(target).request.inspectorTargetMode).toBe('selected-route-leaf');

    expect(selection.begin(second)).toBe(true);
    expect(selection.applyTo(target).request.inspectorRouteSelection).toEqual(second);
    selection.rollback();

    expect(selection.applyTo(target).request.inspectorRouteSelection).toEqual(first);
    expect(selection.applyTo(target).request.inspectorTargetMode).toBe('selected-route-leaf');
    expect(selection.begin(second)).toBe(true);
  });
});

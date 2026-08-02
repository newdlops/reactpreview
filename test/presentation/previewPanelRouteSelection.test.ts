import { describe, expect, it } from 'vitest';
import { PreviewPanelRouteSelection } from '../../src/presentation/previewPanelRouteSelection';
import type { ResolvedPreviewTarget } from '../../src/presentation/activePreviewTarget';

const target = { request: {} } as ResolvedPreviewTarget;
const first = [{ componentName: 'FeatureApp', pattern: '/feature/*' }] as const;
const second = [{ componentName: 'AboutPage', pattern: '/about' }] as const;

describe('PreviewPanelRouteSelection', () => {
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

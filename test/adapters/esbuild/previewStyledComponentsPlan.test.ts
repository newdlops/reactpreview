import { describe, expect, it } from 'vitest';
import {
  PREVIEW_STYLED_COMPONENTS_PLAN_VERSION,
  createPreviewStyledComponentsPlan,
} from '../../../src/adapters/esbuild/previewStyledComponentsPlan';

describe('createPreviewStyledComponentsPlan', () => {
  it('adds the protocol version and deeply freezes JSON-safe plan data', () => {
    const plan = createPreviewStyledComponentsPlan({
      available: true,
      dependencyPaths: ['/workspace/node_modules/styled-components/package.json'],
      evidence: 'authored',
      ignoredReasons: [],
      layers: [{ sourceKind: 'authored', stylisPlugins: { kind: 'binding-array', values: [] } }],
      sharedRuntimeChunk: true,
    });

    expect(plan.version).toBe(PREVIEW_STYLED_COMPONENTS_PLAN_VERSION);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.layers)).toBe(true);
    expect(Object.isFrozen(plan.layers[0])).toBe(true);
    expect(Object.isFrozen(plan.layers[0]?.stylisPlugins)).toBe(true);
  });
});

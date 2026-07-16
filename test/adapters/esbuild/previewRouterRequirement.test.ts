/** Verifies conservative, non-evaluating selection of the optional MemoryRouter boundary. */
import { describe, expect, it } from 'vitest';
import {
  collectPreviewRouterRequirement,
  requiresPreviewRouter,
} from '../../../src/adapters/esbuild/previewRouterRequirement';

describe('requiresPreviewRouter', () => {
  /** Enables route hooks and link components imported directly by a leaf preview module. */
  it('selects direct consumer imports including aliases', () => {
    expect(
      requiresPreviewRouter(
        '/workspace/Preview.tsx',
        "import { useParams as readParams, NavLink } from 'react-router-dom'; export default () => <NavLink to='/' />;",
      ),
    ).toBe(true);
  });

  /** Avoids nesting around files that already import an application-level router provider. */
  it('does not select a file that owns a router', () => {
    expect(
      requiresPreviewRouter(
        '/workspace/App.tsx',
        "import { BrowserRouter, useLocation } from 'react-router-dom'; export default () => <BrowserRouter />;",
      ),
    ).toBe(false);
  });

  /** Preserves consumer and provider evidence separately for target-graph aggregation. */
  it('returns independent graph inventory flags', () => {
    expect(
      collectPreviewRouterRequirement(
        '/workspace/App.tsx',
        "import { BrowserRouter, useLocation } from 'react-router-dom'; export default BrowserRouter;",
      ),
    ).toEqual({ consumesRouter: true, ownsRouter: true });
  });

  /** Tracks namespace property usage while rejecting a namespace-owned provider. */
  it('classifies namespace imports by the properties they use', () => {
    expect(
      requiresPreviewRouter(
        '/workspace/Preview.tsx',
        "import * as Router from 'react-router-dom'; export default () => <Router.Link to='/' />;",
      ),
    ).toBe(true);
    expect(
      requiresPreviewRouter(
        '/workspace/App.tsx',
        "import * as Router from 'react-router-dom'; export default () => <Router.MemoryRouter />;",
      ),
    ).toBe(false);
  });

  /** Ignores erased and unrelated imports so ordinary components retain an identity wrapper. */
  it('ignores type-only and unrelated packages', () => {
    expect(
      requiresPreviewRouter(
        '/workspace/Preview.tsx',
        "import type { LinkProps } from 'react-router-dom'; import { Link } from './Link'; export default Link;",
      ),
    ).toBe(false);
  });
});

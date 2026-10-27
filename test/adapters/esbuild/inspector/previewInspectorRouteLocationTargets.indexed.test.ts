/** Preserves exact route evidence while eliminating repeated immutable graph normalization. */
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isProvenTargetRenderAncestor as ancestor,
  isTransparentRouteComponentCorridorProven as corridor,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteLocationTargets';
import type {
  PreviewRenderChainPlan,
  PreviewRenderChainStep,
} from '../../../../src/adapters/esbuild/renderGraph';

/** Creates one ordinary graph edge without freezing it so mutable fallbacks remain testable. */
function step(
  sourcePath: string,
  label = 'Page',
  kind: PreviewRenderChainStep['kind'] = 're-export',
): PreviewRenderChainStep {
  return { certainty: 'confirmed', kind, label, occurrenceStart: 0, sourcePath, wrapperNames: [] };
}

/** Freezes exactly the path evidence used in production, leaving unrelated plan fields alone. */
function graph(paths: PreviewRenderChainStep[][], frozen = true): PreviewRenderChainPlan {
  return {
    dependencyPaths: [],
    paths: frozen
      ? Object.freeze(
          paths.map((steps, index) =>
            Object.freeze({
              id: String(index),
              steps: Object.freeze(steps.map((edge) => Object.freeze(edge))),
            }),
          ),
        )
      : paths.map((steps, index) => ({ id: String(index), steps })),
    reachability: 'entry-connected',
    target: { sourcePath: '/target.tsx', exportName: 'default' },
    truncated: false,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('immutable route path evidence', () => {
  it('normalizes graph paths once across repeated ancestor and corridor queries', () => {
    const plan = graph([
      Array.from({ length: 80 }, (_, index) => step(`/source/${String(index)}.tsx`)),
      [step('/target.tsx'), step('/page.tsx')],
    ]);
    ancestor('/missing.tsx', ['Page'], plan);
    const normalize = vi.spyOn(path, 'normalize');
    expect(ancestor('/missing.tsx', ['Page'], plan)).toBe(false);
    expect(ancestor('/page.tsx', ['Page'], plan)).toBe(true);
    expect(corridor('/page.tsx', ['Page'], '/target.tsx', plan)).toBe(true);
    expect(corridor('/missing.tsx', ['Page'], '/target.tsx', plan)).toBe(false);
    expect(normalize).toHaveBeenCalledTimes(6);
  });

  it('keeps exact source identity and uses step labels rather than wrapper aliases', () => {
    const plan = graph([
      [{ ...step('/src/./page.tsx', 'memo(ActualPage)'), wrapperNames: ['Sibling'] }],
    ]);
    expect(ancestor('/src/page.tsx', ['ActualPage'], plan)).toBe(true);
    expect(ancestor('/src/page.tsx', ['Sibling'], plan)).toBe(false);
    expect(ancestor('/src/Page.tsx', ['ActualPage'], plan)).toBe(false);
    expect(ancestor('/src/page.tsx', [undefined, 'lowercase'], plan)).toBe(false);
  });

  it('does not combine target and component evidence from separate paths', () => {
    const plan = graph([[step('/target.tsx')], [step('/other.tsx'), step('/page.tsx')]]);
    expect(ancestor('/page.tsx', ['Page'], plan)).toBe(true);
    expect(corridor('/page.tsx', ['Page'], '/target.tsx', plan)).toBe(false);
  });

  it('uses the first target occurrence even when a later occurrence is transparent', () => {
    const plan = graph([
      [step('/target.tsx', 'Target', 'component-render'), step('/target.tsx'), step('/page.tsx')],
    ]);
    expect(corridor('/page.tsx', ['Page'], '/target.tsx', plan)).toBe(false);
  });

  it('includes the target edge and excludes the component edge from corridor checks', () => {
    const plan = graph([
      [step('/target.tsx', 'Target', 'react-lazy'), step('/page.tsx', 'Page', 'component-render')],
    ]);
    expect(corridor('/page.tsx', ['Page'], '/target.tsx', plan)).toBe(true);
    expect(corridor('/target.tsx', ['Target'], '/target.tsx', plan)).toBe(false);
  });

  it('does not skip ordinary owners or truncate long corridors at bit boundaries', () => {
    const long = Array.from({ length: 70 }, (_, index) => step(`/source/${String(index)}.tsx`));
    const open = graph([[step('/target.tsx'), ...long, step('/page.tsx')]]);
    expect(corridor('/page.tsx', ['Page'], '/target.tsx', open)).toBe(true);
    const blocked = graph([
      [
        step('/target.tsx'),
        ...long,
        step('/owner.tsx', 'Owner', 'component-render'),
        step('/page.tsx'),
      ],
    ]);
    expect(corridor('/page.tsx', ['Page'], '/target.tsx', blocked)).toBe(false);
  });

  it('keeps independently frozen graphs isolated', () => {
    const first = graph([[step('/target.tsx'), step('/page.tsx')]]);
    const second = graph([[step('/target.tsx', 'Target', 'component-render'), step('/page.tsx')]]);
    expect(corridor('/page.tsx', ['Page'], '/target.tsx', first)).toBe(true);
    expect(corridor('/page.tsx', ['Page'], '/target.tsx', second)).toBe(false);
    expect(corridor('/page.tsx', ['Page'], '/target.tsx', first)).toBe(true);
  });

  it('observes replacement steps in a mutable path array', () => {
    const steps = [step('/target.tsx'), step('/page.tsx')];
    const plan = graph([steps], false);
    expect(corridor('/page.tsx', ['Page'], '/target.tsx', plan)).toBe(true);
    steps[0] = step('/target.tsx', 'Target', 'component-render');
    steps[1] = step('/sibling.tsx', 'Sibling');
    expect(corridor('/page.tsx', ['Page'], '/target.tsx', plan)).toBe(false);
    expect(ancestor('/page.tsx', ['Page'], plan)).toBe(false);
    expect(ancestor('/sibling.tsx', ['Sibling'], plan)).toBe(true);
  });

  it('observes mutable step fields inside frozen arrays and candidates', () => {
    const owner = { ...step('/page.tsx') };
    const plan = {
      ...graph([]),
      paths: Object.freeze([
        Object.freeze({ id: 'mutable-step', steps: Object.freeze([step('/target.tsx'), owner]) }),
      ]),
    };
    expect(ancestor('/page.tsx', ['Page'], plan)).toBe(true);
    owner.sourcePath = '/sibling.tsx';
    owner.label = 'Sibling';
    expect(ancestor('/page.tsx', ['Page'], plan)).toBe(false);
    expect(ancestor('/sibling.tsx', ['Sibling'], plan)).toBe(true);
  });

  it.each(['sourcePath', 'label', 'kind'] as const)(
    'does not cache an independently changing %s getter',
    (property) => {
      let changed = false;
      const owner = { ...step('/page.tsx') };
      Object.defineProperty(owner, property, {
        enumerable: true,
        get: () =>
          property === 'sourcePath'
            ? changed
              ? '/sibling.tsx'
              : '/page.tsx'
            : property === 'label'
              ? changed
                ? 'Sibling'
                : 'Page'
              : changed
                ? 'component-render'
                : 're-export',
      });
      const plan = graph([[owner, step('/outer.tsx', 'Outer')]]);
      expect(ancestor('/page.tsx', ['Page'], plan)).toBe(true);
      expect(corridor('/outer.tsx', ['Outer'], '/page.tsx', plan)).toBe(true);
      changed = true;
      if (property === 'kind') {
        expect(corridor('/outer.tsx', ['Outer'], '/page.tsx', plan)).toBe(false);
      } else {
        expect(ancestor('/page.tsx', ['Page'], plan)).toBe(false);
      }
    },
  );

  it('does not retain changing accessors on otherwise frozen steps', () => {
    let sourcePath = '/page.tsx';
    let label = 'Page';
    let kind: PreviewRenderChainStep['kind'] = 're-export';
    const changing = {
      ...step('/page.tsx'),
      get sourcePath(): string {
        return sourcePath;
      },
      get label(): string {
        return label;
      },
    };
    const target = {
      ...step('/target.tsx'),
      get kind(): PreviewRenderChainStep['kind'] {
        return kind;
      },
    };
    const plan = graph([[target, changing]]);
    expect(corridor('/page.tsx', ['Page'], '/target.tsx', plan)).toBe(true);
    sourcePath = '/sibling.tsx';
    label = 'Sibling';
    kind = 'component-render';
    expect(ancestor('/page.tsx', ['Page'], plan)).toBe(false);
    expect(ancestor('/sibling.tsx', ['Sibling'], plan)).toBe(true);
    expect(corridor('/sibling.tsx', ['Sibling'], '/target.tsx', plan)).toBe(false);
  });
});

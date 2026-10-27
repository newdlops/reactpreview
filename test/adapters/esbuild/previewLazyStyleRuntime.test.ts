/** Exercises cached-module CSS ownership across entry revisions without simulating ESM reevaluation. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  planPreviewLazyStyleOutputs,
  PREVIEW_LAZY_STYLE_LOADER_SYMBOL,
  type PreviewJoinedBuildOutput,
} from '../../../src/adapters/esbuild/previewLazyStyleOutputs';
import { MAXIMUM_PREVIEW_EVALUATED_STYLE_MODULES } from '../../../src/adapters/esbuild/previewLazyStyleRuntimeSource';

/** Browser link surface needed to observe loading, media activation, and cancellation. */
interface TestStyleLink {
  readonly dataset: Record<string, string>;
  href: string;
  media: string;
  rel: string;
  readonly isConnected: boolean;
  readonly listeners: Map<string, Set<() => void>>;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  remove(): void;
  before(link: TestStyleLink): void;
}

/** Entry-local loader API shared by stable module prefixes and the generated React entry. */
interface TestStyleLoader {
  (moduleUrl: string): Promise<void>;
  import(specifier: string, importerUrl: string, module: Promise<unknown>): Promise<unknown>;
  readonly ready?: Promise<void>;
  readonly evaluatedModules?: Set<string>;
  readonly requiresDocumentReload?: boolean;
  activate?(): void;
  commit(): void;
  dispose?(): void;
}

/** Observable browser state; no JavaScript module is reevaluated for a cached import. */
interface TestStyleBrowser {
  readonly links: TestStyleLink[];
  readonly requests: string[];
  readonly warnings: unknown[];
  currentLoader(): TestStyleLoader;
  evaluate(styles: Readonly<Record<string, string | undefined>>): TestStyleLoader;
  failNextLoad(): void;
}

const ROOT = 'https://preview.invalid/session/';
const PAGE = ROOT + 'chunks/page.js';
const EDITOR = ROOT + 'chunks/editor.js';

describe('lazy stylesheet revision ownership', () => {
  it('keeps cached module styles across repeated entry imports without loading unopened styles', async () => {
    const browser = createStyleBrowser();
    const first = browser.evaluate({
      page: 'body { margin: 0; }',
      editor: 'body { margin: 8px; }',
    });
    await first(PAGE);
    first.commit();
    const original = browser.links[0];
    expect(browser.links).toHaveLength(1);
    for (let revision = 0; revision < 3; revision += 1) {
      const replacement = browser.evaluate({
        page: 'body { margin: 0; }',
        editor: 'body { margin: 8px; }',
      });
      // The browser has cached page.js. Its stable prefix does not run a second time.
      await replacement.ready;
      replacement.activate?.();
      replacement.commit();
      await replacement(PAGE);
      expect(browser.links).toEqual([original]);
    }
    expect(browser.requests).toHaveLength(1);
  });

  it('prepares changed CSS for cached JavaScript before replacing the visible stylesheet', async () => {
    const browser = createStyleBrowser();
    const first = browser.evaluate({ page: 'body { margin: 0; }' });
    await first(PAGE);
    first.commit();
    const previous = browser.links[0];
    const replacement = browser.evaluate({ page: 'body { margin: 4px; }' });
    await replacement.ready;
    expect(browser.links).toHaveLength(2);
    expect(previous?.media).toBe('');
    const prepared = browser.links[0];
    expect(prepared?.media).toBe('not all');
    replacement.activate?.();
    expect(prepared?.media).toBe('');
    expect(browser.links).toEqual([prepared]);
    replacement.commit();
    expect(browser.links).toHaveLength(1);
    expect(browser.links[0]).not.toBe(previous);
  });

  it('remembers a cached module with no CSS when it later acquires a stylesheet', async () => {
    const browser = createStyleBrowser();
    const first = browser.evaluate({});
    await first(PAGE);
    first.commit();
    expect(browser.links).toHaveLength(0);
    const replacement = browser.evaluate({ page: 'body { margin: 0; }' });
    await replacement.ready;
    replacement.activate?.();
    replacement.commit();
    expect(browser.links).toHaveLength(1);
  });

  it('retires removed CSS and restores a returning cached module without evaluating its prefix', async () => {
    const browser = createStyleBrowser();
    const first = browser.evaluate({ page: 'body { margin: 0; }' });
    await first(PAGE);
    first.commit();
    const removed = browser.evaluate({});
    await removed.ready;
    removed.activate?.();
    removed.commit();
    expect(browser.links).toHaveLength(0);
    const returned = browser.evaluate({ page: 'body { margin: 0; }' });
    await returned.ready;
    returned.activate?.();
    returned.commit();
    expect(browser.links).toHaveLength(1);
    expect(browser.requests).toHaveLength(2);
  });

  it('deduplicates concurrent CSS requests and preserves a previously opened lazy editor', async () => {
    const browser = createStyleBrowser();
    const styles = { page: 'body { margin: 0; }', editor: 'body { margin: 8px; }' };
    const first = browser.evaluate(styles);
    await Promise.all([first(PAGE), first(PAGE), first(EDITOR), first(EDITOR)]);
    first.commit();
    const replacement = browser.evaluate(styles);
    await replacement.ready;
    replacement.activate?.();
    replacement.commit();
    await Promise.all([replacement(PAGE), replacement(EDITOR)]);
    expect(browser.links).toHaveLength(2);
    expect(browser.requests).toHaveLength(2);
  });

  it('preserves cascade position when an earlier cached module changes CSS', async () => {
    const browser = createStyleBrowser();
    const first = browser.evaluate({
      page: 'body { margin: 0; }',
      editor: 'body { margin: 8px; }',
    });
    await first(PAGE);
    await first(EDITOR);
    first.commit();
    const editor = browser.links[1];
    const replacement = browser.evaluate({
      page: 'body { margin: 4px; }',
      editor: 'body { margin: 8px; }',
    });
    await replacement.ready;
    replacement.activate?.();
    replacement.commit();
    expect(browser.links).toHaveLength(2);
    expect(browser.links[1]).toBe(editor);
    expect(browser.links.every((link) => link.media === '')).toBe(true);
  });

  it('rolls back cancellation without retagging or removing visible styles', async () => {
    const browser = createStyleBrowser();
    const first = browser.evaluate({ page: 'body { margin: 0; }' });
    await first(PAGE);
    first.commit();
    const previous = browser.links[0];
    const revision = previous?.dataset.reactPreviewLazyStyleRevision;
    const replacement = browser.evaluate({ page: 'body { margin: 4px; }' });
    await replacement.ready;
    replacement.dispose?.();
    replacement.commit();
    expect(browser.links).toEqual([previous]);
    expect(previous?.dataset.reactPreviewLazyStyleRevision).toBe(revision);
    expect(browser.currentLoader()).toBe(first);
  });

  it('rejects failed replacement CSS while retaining the previous document styles', async () => {
    const browser = createStyleBrowser();
    const first = browser.evaluate({ page: 'body { margin: 0; }' });
    await first(PAGE);
    first.commit();
    const previous = browser.links[0];
    browser.failNextLoad();
    const replacement = browser.evaluate({ page: 'body { margin: 4px; }' });
    await expect(replacement.ready).rejects.toThrow('could not load a lazy project stylesheet');
    replacement.dispose?.();
    expect(browser.links).toEqual([previous]);
    expect(previous?.media).toBe('');
    expect(browser.currentLoader()).toBe(first);
  });

  it('does not hide the first render when a cosmetic stylesheet fails', async () => {
    const browser = createStyleBrowser();
    const first = browser.evaluate({ page: 'body { margin: 0; }' });
    browser.failNextLoad();
    await expect(first(PAGE)).resolves.toBeUndefined();
    first.commit();
    expect(browser.links).toHaveLength(0);
    expect(browser.warnings).toHaveLength(1);
  });

  it('keeps document history bounded and requests the existing document fallback at capacity', async () => {
    const browser = createStyleBrowser();
    const first = browser.evaluate({});
    await first(PAGE);
    const history = first.evaluatedModules;
    if (history === undefined) throw new Error('Loader did not expose its evaluation witnesses.');
    for (let index = 1; index < MAXIMUM_PREVIEW_EVALUATED_STYLE_MODULES; index += 1) {
      history.add(ROOT + 'chunks/previous-' + String(index) + '.js');
    }
    first.commit();
    const replacement = browser.evaluate({ editor: 'body { margin: 8px; }' });
    await replacement(EDITOR);
    expect(replacement.requiresDocumentReload).toBe(true);
    expect(history.size).toBe(MAXIMUM_PREVIEW_EVALUATED_STYLE_MODULES);
    replacement.dispose?.();
    expect(browser.links).toHaveLength(0);
  });

  it('restores CSS when a canceled preparation already evaluated a later cached import', async () => {
    const browser = createStyleBrowser();
    const styles = { page: 'body { margin: 0; }', editor: 'body { margin: 8px; }' };
    const first = browser.evaluate(styles);
    await first(PAGE);
    first.commit();
    const replacement = browser.evaluate(styles);
    await replacement.ready;
    await replacement(EDITOR);
    replacement.dispose?.();
    expect(browser.links).toHaveLength(1);
    const cachedNamespace = { editor: true };
    await expect(
      first.import('./chunks/editor.js', ROOT + 'entry.js', Promise.resolve(cachedNamespace)),
    ).resolves.toBe(cachedNamespace);
    expect(browser.links).toHaveLength(2);
    expect(browser.links.every((link) => link.rel === 'stylesheet' && link.media === '')).toBe(
      true,
    );
  });

  it('does not admit canceled optional CSS during a later untouched refresh', async () => {
    const browser = createStyleBrowser();
    const styles = { page: 'body { margin: 0; }', editor: 'body { margin: 8px; }' };
    const first = browser.evaluate(styles);
    await first(PAGE);
    first.commit();
    const original = browser.links[0];
    const canceled = browser.evaluate(styles);
    await canceled.ready;
    await canceled(EDITOR);
    canceled.dispose?.();
    const next = browser.evaluate(styles);
    await next.ready;
    next.activate?.();
    next.commit();
    expect(browser.links).toEqual([original]);
  });

  it('preserves an old page late import when the speculative revision is canceled', async () => {
    const browser = createStyleBrowser();
    const styles = { page: 'body { margin: 0; }', editor: 'body { margin: 8px; }' };
    const first = browser.evaluate(styles);
    await first(PAGE);
    first.commit();
    const canceled = browser.evaluate(styles);
    await canceled.ready;
    await canceled(EDITOR);
    await first.import('./chunks/editor.js', ROOT + 'entry.js', Promise.resolve({ editor: true }));
    canceled.dispose?.();
    const next = browser.evaluate(styles);
    await next.ready;
    next.activate?.();
    next.commit();
    expect(browser.links).toHaveLength(2);
    expect(browser.links.every((link) => link.media === '')).toBe(true);
  });

  it('adopts an old page late cached import before committing the replacement', async () => {
    const browser = createStyleBrowser();
    const styles = { page: 'body { margin: 0; }', editor: 'body { margin: 8px; }' };
    const first = browser.evaluate(styles);
    await first(PAGE);
    first.commit();
    const canceled = browser.evaluate(styles);
    await canceled(EDITOR);
    canceled.dispose?.();
    const next = browser.evaluate(styles);
    await next.ready;
    await first.import('./chunks/editor.js', ROOT + 'entry.js', Promise.resolve({ editor: true }));
    next.commit();
    expect(browser.links).toHaveLength(2);
    expect(next.requiresDocumentReload).toBe(false);
  });

  it('requests document replacement when a late active module has different unprepared CSS', async () => {
    const browser = createStyleBrowser();
    const styles = { page: 'body { margin: 0; }', editor: 'body { margin: 8px; }' };
    const first = browser.evaluate(styles);
    await first(PAGE);
    first.commit();
    const canceled = browser.evaluate(styles);
    await canceled(EDITOR);
    canceled.dispose?.();
    const next = browser.evaluate({ ...styles, editor: 'body { margin: 16px; }' });
    await next.ready;
    await first.import('./chunks/editor.js', ROOT + 'entry.js', Promise.resolve({ editor: true }));
    const previous = [...browser.links];
    next.activate?.();
    expect(next.requiresDocumentReload).toBe(true);
    expect(browser.links).toEqual(previous);
    next.dispose?.();
    expect(browser.currentLoader()).toBe(first);
    expect(browser.links).toEqual(previous);
  });

  it('remembers an actually opened cached module before that module acquires CSS', async () => {
    const browser = createStyleBrowser();
    const first = browser.evaluate({});
    await first(PAGE);
    first.commit();
    const canceled = browser.evaluate({});
    await canceled(EDITOR);
    canceled.dispose?.();
    await first.import('./chunks/editor.js', ROOT + 'entry.js', Promise.resolve({ editor: true }));
    const next = browser.evaluate({ editor: 'body { margin: 8px; }' });
    await next.ready;
    next.activate?.();
    next.commit();
    expect(browser.links).toHaveLength(1);
  });

  it('retains newly committed optional CSS across the next cached entry import', async () => {
    const browser = createStyleBrowser();
    const styles = { page: 'body { margin: 0; }', editor: 'body { margin: 8px; }' };
    const first = browser.evaluate(styles);
    await first(PAGE);
    first.commit();
    const prepared = browser.evaluate(styles);
    await prepared.ready;
    await prepared(EDITOR);
    prepared.commit();
    const next = browser.evaluate(styles);
    await next.ready;
    next.commit();
    expect(browser.links).toHaveLength(2);
    expect(browser.links.every((link) => link.media === '')).toBe(true);
  });

  it('does not apply a preloaded stylesheet when its native module import fails', async () => {
    const browser = createStyleBrowser();
    const first = browser.evaluate({ editor: 'body { margin: 8px; }' });
    first.commit();
    await expect(
      first.import(
        './chunks/editor.js',
        ROOT + 'entry.js',
        Promise.reject(new Error('native module failed')),
      ),
    ).rejects.toThrow('native module failed');
    expect(browser.links).toHaveLength(0);
    expect(first.evaluatedModules?.has(EDITOR)).toBe(false);
  });

  it('deduplicates already loaded CSS for repeated native cached imports', async () => {
    const browser = createStyleBrowser();
    const first = browser.evaluate({ page: 'body { margin: 0; }' });
    await first(PAGE);
    first.commit();
    await Promise.all([
      first.import('./chunks/page.js', ROOT + 'entry.js', Promise.resolve(1)),
      first.import('./chunks/page.js', ROOT + 'entry.js', Promise.resolve(2)),
    ]);
    expect(browser.requests).toHaveLength(1);
    expect(browser.links).toHaveLength(1);
  });
});

/** Creates planner output bytes and a minimal DOM whose link loads settle on a browser microtask. */
function createStyleBrowser(): TestStyleBrowser {
  const links: TestStyleLink[] = [];
  const requests: string[] = [];
  const warnings: unknown[] = [];
  let failNext = false;
  const load = (link: TestStyleLink): void => {
    requests.push(link.href);
    const event = failNext ? 'error' : 'load';
    failNext = false;
    queueMicrotask(() => {
      for (const listener of link.listeners.get(event) ?? []) listener();
    });
  };
  const context = vm.createContext({
    URL,
    console: {
      warn(value: unknown) {
        warnings.push(value);
      },
    },
    document: {
      querySelectorAll: (selector: string) =>
        links.filter((link) =>
          selector.includes('[data-react-preview-lazy-style]')
            ? link.dataset.reactPreviewLazyStyle === 'true'
            : link.dataset.reactPreviewLazyStylePreload === 'true',
        ),
      createElement: () => {
        const link: TestStyleLink = {
          dataset: {},
          href: '',
          media: '',
          rel: '',
          listeners: new Map(),
          get isConnected() {
            return links.includes(this);
          },
          before(link) {
            const index = links.indexOf(this);
            if (index >= 0) {
              links.splice(index, 0, link);
              load(link);
            }
          },
          addEventListener(type, listener) {
            const listeners = this.listeners.get(type) ?? new Set();
            listeners.add(listener);
            this.listeners.set(type, listeners);
          },
          removeEventListener(type, listener) {
            this.listeners.get(type)?.delete(listener);
          },
          remove() {
            const index = links.indexOf(this);
            if (index >= 0) links.splice(index, 1);
          },
        };
        return link;
      },
      head: {
        append(link: TestStyleLink) {
          links.push(link);
          load(link);
        },
      },
    },
  });
  let revision = 0;
  return {
    links,
    requests,
    warnings,
    failNextLoad() {
      failNext = true;
    },
    currentLoader(): TestStyleLoader {
      return vm.runInContext(
        'globalThis[Symbol.for(' + JSON.stringify(PREVIEW_LAZY_STYLE_LOADER_SYMBOL) + ')]',
        context,
      ) as TestStyleLoader;
    },
    evaluate(styles: Readonly<Record<string, string | undefined>>): TestStyleLoader {
      const outputs = createStyleOutputs(styles);
      const plan = planPreviewLazyStyleOutputs('out/entry.js', outputs, {});
      if (plan === undefined) throw new Error('Lazy style fixture did not produce a plan.');
      const url = ROOT + 'entry.js?revision=' + String(revision++);
      return vm.runInContext(
        '(() => {' +
          new TextDecoder()
            .decode(plan.entryPrefix)
            .replaceAll('import.meta.url', JSON.stringify(url)) +
          '\nreturn globalThis[Symbol.for(' +
          JSON.stringify(PREVIEW_LAZY_STYLE_LOADER_SYMBOL) +
          ')];})()',
        context,
      ) as TestStyleLoader;
    },
  };
}

/** Joins two known JavaScript modules with optional exclusive CSS inputs for the real planner. */
function createStyleOutputs(
  styles: Readonly<Record<string, string | undefined>>,
): PreviewJoinedBuildOutput[] {
  const names = ['page', 'editor'];
  const outputs: PreviewJoinedBuildOutput[] = [];
  for (const name of ['entry', ...names]) {
    const css = styles[name];
    const relativePath = name === 'entry' ? 'entry.js' : 'chunks/' + name + '.js';
    outputs.push({
      contents: new TextEncoder().encode('export {};'),
      metadataPath: 'out/' + relativePath,
      relativePath,
      metadata: {
        bytes: 1,
        exports: [],
        imports: [],
        inputs: css === undefined ? {} : { [name + '.css']: { bytesInOutput: 0 } },
        ...(css === undefined ? {} : { cssBundle: 'out/' + name + '.css' }),
      },
    });
    if (css !== undefined)
      outputs.push({
        contents: new TextEncoder().encode(css),
        metadataPath: 'out/' + name + '.css',
        relativePath: name + '.css',
        metadata: {
          bytes: css.length,
          exports: [],
          imports: [],
          inputs: { [name + '.css']: { bytesInOutput: css.length } },
        },
      });
  }
  return outputs;
}

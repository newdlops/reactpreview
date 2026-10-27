/** Verify caller-specific source ceilings, shared reads, and exact dirty-editor identities. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import {
  PreviewProjectFileAnalysisCache,
  type PreviewProjectSourceRecord,
} from '../../../src/adapters/esbuild/previewProjectFileAnalysisCache';
import { PreviewProjectUsageCache } from '../../../src/adapters/esbuild/previewProjectUsageCache';
import type { PreviewTargetUsagePropsOptions } from '../../../src/adapters/esbuild/previewTargetUsageProps';

for (const largerFirst of [false, true])
  it(`keeps each concurrent caller's byte ceiling when largerFirst=${String(largerFirst)}`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'preview-read-ceiling-')),
      file = path.join(directory, 'module.ts'),
      text = 'export const text = "' + 'x'.repeat(120) + '";';
    try {
      await writeFile(file, text);
      const cache = new PreviewProjectFileAnalysisCache(),
        small = (): Promise<PreviewProjectSourceRecord | undefined> =>
          cache.readSource({ sourcePath: file, maximumBytes: 64 }),
        large = (): Promise<PreviewProjectSourceRecord | undefined> =>
          cache.readSource({ sourcePath: file, maximumBytes: 256 });
      const [first, second] = await Promise.all(
          largerFirst ? [large(), small()] : [small(), large()],
        ),
        accepted = largerFirst ? first : second,
        rejected = largerFirst ? second : first;
      expect(accepted?.sourceText).toBe(text);
      expect(rejected).toBeUndefined();
      cache.clear();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

it('still coalesces simultaneous cold reads that have the same ceiling', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'preview-read-sharing-')),
    file = path.join(directory, 'module.ts');
  try {
    await writeFile(file, 'export const value=1;');
    const cache = new PreviewProjectFileAnalysisCache(),
      read = (): Promise<PreviewProjectSourceRecord | undefined> =>
        cache.readSource({ sourcePath: file, maximumBytes: 256 });
    const [a, b, c] = await Promise.all([read(), read(), read()]);
    expect(a?.sourceText).toBe('export const value=1;');
    expect(b).toBe(a);
    expect(c).toBe(a);
    cache.clear();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('does not reuse a different unpaired UTF-16 editor snapshot', async () => {
  const cache = new PreviewProjectFileAnalysisCache(),
    sourcePath = '/virtual/editor.ts',
    text = (unit: number): string => 'export const value="' + String.fromCharCode(unit) + '";';
  const first = await cache.readSource({
      sourcePath,
      snapshotText: text(0xd800),
      maximumBytes: 1024,
    }),
    second = await cache.readSource({ sourcePath, snapshotText: text(0xd801), maximumBytes: 1024 });
  expect(second?.sourceText).toBe(text(0xd801));
  expect(second?.fingerprint).not.toBe(first?.fingerprint);
  cache.clear();
});

it('updates import and render facts for distinct raw editor characters', () => {
  const cache = new PreviewProjectFileAnalysisCache(),
    file = '/virtual/page.tsx',
    text = (unit: number): string =>
      'import {Panel} from "./' + String.fromCharCode(unit) + '";export const Page=()=> <Panel/>;';
  const before = text(0xd800),
    after = text(0xd801),
    first = cache.analyzeRenderSource(file, before);
  expect(cache.collectModuleSpecifiers(file, before)).toEqual(['./' + String.fromCharCode(0xd800)]);
  expect(cache.collectModuleSpecifiers(file, after)).toEqual(['./' + String.fromCharCode(0xd801)]);
  expect(cache.analyzeRenderSource(file, after)).not.toBe(first);
  cache.clear();
});

it('revalidates target usage after a distinct raw UTF-16 editor revision', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'preview-usage-utf16-')),
    file = path.join(root, 'src/Target.tsx'),
    entry = path.join(root, 'src/main.tsx');
  try {
    await mkdir(path.dirname(file));
    await writeFile(file, 'export default function Target(){return null;}');
    await writeFile(
      entry,
      'import {createRoot} from "react-dom/client";import Target from "./Target";createRoot(document.body).render(<Target/>);',
    );
    const cache = new PreviewProjectUsageCache(),
      input = (unit: number): Omit<PreviewTargetUsagePropsOptions, 'sourcePaths'> => ({
        documentPath: file,
        exports: [{ displayName: 'default', exportName: 'default', kind: 'explicit' }],
        inspectorExportName: 'default',
        projectRoot: root,
        snapshots: [],
        sourceText:
          'export default function Target(){return <span title={"' +
          String.fromCharCode(unit) +
          '"}/>;}',
        workspaceRoot: root,
      });
    const first = await cache.discover(input(0xd800));
    expect(first.inspectorPlan?.renderChain.reachability).toBe('entry-connected');
    expect(await cache.discover(input(0xd800))).toBe(first);
    const second = await cache.discover(input(0xd801));
    expect(second).not.toBe(first);
    expect(second.inspectorPlan?.renderChain.reachability).toBe('entry-connected');
    cache.clear();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/** Authored consumers retain a share of the existing read budget after dynamic owner discovery. */
import path from 'node:path';
import { expect, it } from 'vitest';
import { collectReverseClosure } from '../../../../src/adapters/esbuild/inspector/previewInspectorFastCorridorReverse';
import { MINIMUM_TARGETED_REVERSE_FILES } from '../../../../src/adapters/esbuild/inspector/previewInspectorFastCorridorModel';

const ROOT = '/virtual/preview-reverse-scheduling';
const TARGET = ROOT + '/src/components/Widget.tsx';
const OVERLAY_PAGE = ROOT + '/src/pages/initial-page.tsx';
const PAGE = ROOT + '/src/pages/main-page.tsx';
const SECTION = ROOT + '/src/feature/sections/widget-section.tsx';

/** Resolves only exact inert fixture imports and never consults package or application code. */
function createResolver(sources: ReadonlyMap<string, string>) {
  return (specifier: string, consumer: string): string | undefined => {
    const target = path.resolve(path.dirname(consumer), specifier);
    return [target, target + '.tsx'].find((candidate) => sources.has(candidate));
  };
}

it.each([false, true])(
  'retains late pivot turns and short batches with page consumers=%s',
  async (preferPageConsumers) => {
    const direct = ROOT + '/src/other/section.tsx';
    const owner = ROOT + '/src/distant/config/owner.tsx';
    const page = ROOT + '/src/final/page.tsx';
    const early = Array.from(
      { length: 6 },
      (_, index) => ROOT + '/src/early/owner-' + index.toString() + '.tsx',
    );
    const noise = Array.from(
      { length: 90 },
      (_, index) => ROOT + '/src/noise/' + index.toString() + '.tsx',
    );
    const promoted = Array.from(
      { length: 64 },
      (_, index) => ROOT + '/src/unrelated/' + index.toString() + '.tsx',
    );
    const targeted = [...early, ...noise];
    targeted.splice(52, 0, direct);
    const modules = new Map<string, string>([
      ['@target', TARGET],
      ['@section', direct],
      ['@owner', owner],
      ...early.map((file, index): [string, string] => ['@early' + index.toString(), file]),
    ]);
    const sources = new Map<string, string>([
      [TARGET, 'export const Widget=()=> <table/>;'],
      [
        direct,
        'import {Widget} from "@target";export const Section=()=> <article><Widget/></article>;',
      ],
      [
        owner,
        'import {Section} from "@section";export const Owner=()=> <section><Section/></section>;',
      ],
      [page, 'import {Owner} from "@owner";export const Page=()=> <main><Owner/></main>;'],
      ...early.map((file, index): [string, string] => [
        file,
        index === 0
          ? 'import {Widget} from "@target";export const Early0=()=> <Widget/>;'
          : 'import {Early' +
            (index - 1).toString() +
            '} from "@early' +
            (index - 1).toString() +
            '";export const Early' +
            index.toString() +
            '=()=> <Early' +
            (index - 1).toString() +
            '/>;',
      ]),
      ...[...noise, ...promoted].map((file): [string, string] => [
        file,
        'export const unrelated=1;',
      ]),
    ]);
    const pivots: string[] = [];
    const reads: string[] = [];
    const result = await collectReverseClosure({
      documentPath: TARGET,
      projectRoot: ROOT,
      workspaceRoot: ROOT,
      targetExportName: 'Widget',
      selectedPageConsumerPaths: [early[0] ?? ''],
      targetedPagePaths: targeted,
      snapshotPaths: [],
      resolveModule: (specifier) => modules.get(specifier),
      readSource: (file) => {
        reads.push(file);
        return Promise.resolve(sources.get(file));
      },
      pageCandidateIndex: {
        selectPageConsumers: (pivot) =>
          preferPageConsumers ? (pivot === direct ? [owner] : pivot === owner ? [page] : []) : [],
        selectReverseProbes: (pivot) => {
          pivots.push(pivot);
          return pivot === direct
            ? [...(preferPageConsumers ? promoted : []), owner]
            : pivot === owner
              ? [...(preferPageConsumers ? promoted : []), page]
              : promoted;
        },
      },
    });
    expect(result.childByOwner.get(page)).toBe(owner);
    expect(result.childByOwner.get(owner)).toBe(direct);
    expect(result.pageProvenancePaths).toContain(page);
    expect(pivots).toContain(direct);
    expect(pivots.length).toBeLessThanOrEqual(6);
    expect(reads.length).toBeLessThanOrEqual(641);
    expect(reads.filter((file) => file === page)).toHaveLength(1);
  },
);

for (const inventoryReversed of [false, true]) {
  it(`keeps a second authored use site beside promoted descendants, reversed=${String(inventoryReversed)}`, async () => {
    const originalNoise = Array.from(
      { length: 94 },
      (_, index) => ROOT + '/src/candidates/item-' + index.toString() + '.tsx',
    );
    const promotedNoise = Array.from(
      { length: 64 },
      (_, index) => ROOT + '/src/dynamic/many/item-' + index.toString() + '.tsx',
    );
    const targeted = [OVERLAY_PAGE, PAGE, ...originalNoise];
    targeted.splice(52, 0, SECTION);
    const sources = new Map([
      [TARGET, 'export const Widget=()=> <table/>;'],
      [
        OVERLAY_PAGE,
        'import {Widget} from "../components/Widget";export const InitialPage=()=> <Dialog><Widget/></Dialog>;',
      ],
      [
        PAGE,
        'import {WidgetSection} from "../feature/sections/widget-section";export const MainPage=()=> <main><WidgetSection/></main>;',
      ],
      [
        SECTION,
        'import {Widget} from "../../components/Widget";export const WidgetSection=()=> <section><Widget/></section>;',
      ],
      ...[...originalNoise, ...promotedNoise].map((file): [string, string] => [
        file,
        'export const unrelated=1;',
      ]),
    ]);
    const reads: string[] = [];
    const result = await collectReverseClosure({
      documentPath: TARGET,
      pageCandidateIndex: {
        selectPageConsumers: () => [OVERLAY_PAGE, PAGE],
        selectReverseProbes: () => promotedNoise,
      },
      projectRoot: ROOT,
      workspaceRoot: ROOT,
      readSource: (file) => {
        reads.push(file);
        return Promise.resolve(sources.get(file));
      },
      resolveModule: createResolver(sources),
      selectedPageConsumerPaths: [OVERLAY_PAGE, PAGE],
      snapshotPaths: inventoryReversed ? [...sources.keys()].reverse() : [...sources.keys()],
      targetedPagePaths: targeted,
      targetExportName: 'Widget',
    });

    expect(result.childByOwner.get(SECTION)).toBe(TARGET);
    expect(result.childByOwner.get(PAGE)).toBe(SECTION);
    expect(result.paths).toContain(OVERLAY_PAGE);
    expect(result.paths).toContain(SECTION);
    expect(result.pageProvenancePaths).toContain(PAGE);
    expect(reads.indexOf(SECTION)).toBeLessThanOrEqual(MINIMUM_TARGETED_REVERSE_FILES);
    expect(reads.filter((file) => file === SECTION)).toHaveLength(1);
  });
}

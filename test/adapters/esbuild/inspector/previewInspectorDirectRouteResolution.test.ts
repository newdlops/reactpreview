/** Verifies direct route resolution accounts for every exact authored occurrence. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PreviewRenderChainPlan } from '../../../../src/adapters/esbuild/renderGraph';
import type {
  PreviewInspectorDirectRouteChoice,
  PreviewInspectorDirectRouteComponentReference,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorDirectRouteChoiceTypes';
import { collectPreviewInspectorDirectRouteChoices } from '../../../../src/adapters/esbuild/inspector/previewInspectorDirectRouteChoices';
import type { PreviewInspectorDirectRoutePathEvidence } from '../../../../src/adapters/esbuild/inspector/previewInspectorDirectRoutePathEvidence';
import {
  resolvePreviewInspectorDirectRouteChoices,
  type PreviewInspectorDirectRouteResolution,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorDirectRouteResolution';
import { collectPreviewInspectorRouteLocationInventory } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteLocation';
import type { PreviewInspectorRouteLocationInventory } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteLocationTypes';

const ROOT = '/workspace/src';
const OWNER_PATH = `${ROOT}/routes.tsx`;
const CONTEXT_PATH = `${ROOT}/app.tsx`;

interface ChoiceOptions {
  readonly evidence?: PreviewInspectorDirectRoutePathEvidence;
  readonly exportName?: string;
  readonly pattern?: string;
  readonly referenceSourcePath?: string;
}

/** Creates one inert direct occurrence without relying on parser position coincidences. */
function createChoice(
  occurrenceIdentity: string,
  componentName: string,
  options: ChoiceOptions = {},
): PreviewInspectorDirectRouteChoice {
  const reference: PreviewInspectorDirectRouteComponentReference = Object.freeze({
    exportName: options.exportName ?? 'default',
    sourcePath: options.referenceSourcePath ?? `${ROOT}/${componentName}.tsx`,
  });
  const pathEvidence = options.evidence ?? Object.freeze({ kind: 'literal' as const });
  return Object.freeze({
    componentName,
    occurrenceIdentity,
    occurrenceStart: occurrenceIdentity.length,
    pathEvidence,
    pathResolution: pathEvidence.kind === 'literal' ? 'resolved' : 'unresolved',
    pattern: options.pattern ?? '/',
    reference,
    sourcePath: OWNER_PATH,
  });
}

/** Independently checks member equality and pairwise disjointness, not emitted count sums. */
function expectTotalPartition(
  input: readonly PreviewInspectorDirectRouteChoice[],
  resolution: PreviewInspectorDirectRouteResolution,
): void {
  const inputIds = new Set(input.map((choice) => choice.occurrenceIdentity));
  const groups = [
    new Set(resolution.selectable.map((item) => item.choice.occurrenceIdentity)),
    new Set(resolution.unresolved.map((item) => item.choice.occurrenceIdentity)),
    new Set(resolution.duplicates.map((item) => item.choice.occurrenceIdentity)),
  ];
  const outputIds = new Set(groups.flatMap((group) => [...group]));
  expect([...outputIds].sort()).toEqual([...inputIds].sort());
  for (const [index, group] of groups.entries()) {
    for (const occurrenceId of group) {
      expect(
        groups.every((other, otherIndex) => otherIndex === index || !other.has(occurrenceId)),
      ).toBe(true);
    }
  }
  expect(groups.reduce((total, group) => total + group.size, 0)).toBe(input.length);
}

/** Builds the compiler-owned selected target used to qualify contextual route references. */
function createRenderChain(
  targetPath: string,
  targetExportName = 'default',
  targetLabel = 'SharedPage',
): PreviewRenderChainPlan {
  return {
    dependencyPaths: [targetPath, CONTEXT_PATH],
    paths: [
      {
        id: 'contextual-target',
        steps: [
          {
            certainty: 'confirmed',
            kind: 'component-render',
            label: targetLabel,
            occurrenceStart: 10,
            sourcePath: CONTEXT_PATH,
            wrapperNames: [],
          },
        ],
      },
    ],
    reachability: 'entry-connected',
    target: { exportName: targetExportName, sourcePath: targetPath },
    truncated: false,
  };
}

/** Collects a target page against direct routes authored only in its render-path context. */
async function collectContextualInventory(options: {
  readonly modulePaths: Readonly<Record<string, string>>;
  readonly sources: Readonly<Record<string, string>>;
  readonly targetExportName?: string;
  readonly targetLabel?: string;
  readonly targetPath: string;
}): Promise<PreviewInspectorRouteLocationInventory> {
  return collectPreviewInspectorRouteLocationInventory({
    documentPath: options.targetPath,
    exportName: options.targetExportName ?? 'default',
    readSource: (sourcePath) => Promise.resolve(options.sources[sourcePath]),
    renderChain: createRenderChain(
      options.targetPath,
      options.targetExportName,
      options.targetLabel,
    ),
    resolveModule: (specifier, importer) =>
      importer === CONTEXT_PATH ? options.modulePaths[specifier] : undefined,
    sourcePaths: [CONTEXT_PATH],
  });
}

/** Confirms contextual evidence did not leak into exhaustive owner branch accounting. */
function expectNoOwnerRows(inventory: PreviewInspectorRouteLocationInventory): void {
  expect(inventory.choices).toEqual([]);
  expect(inventory.unresolvedFactoryOptions).toBeUndefined();
  expect(inventory.directRouteDuplicates).toBeUndefined();
}

describe('resolvePreviewInspectorDirectRouteChoices', () => {
  it('maps a declaration-backed imported JSX component to its adjacent package runtime', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'preview-direct-route-runtime-'));
    const ownerPath = path.join(workspaceRoot, 'src', 'routes.tsx');
    const declarationPath = path.join(
      workspaceRoot,
      'node_modules',
      'react-router-dom',
      'dist',
      'index.d.ts',
    );
    const runtimePath = path.join(
      workspaceRoot,
      'node_modules',
      'react-router-dom',
      'dist',
      'index.js',
    );
    const sourceText = [
      'import { Navigate } from "react-router-dom";',
      '<Routes><Route path="/my" element={<Navigate replace to="/" />} /></Routes>;',
    ].join('\n');
    try {
      await mkdir(path.dirname(declarationPath), { recursive: true });
      await Promise.all([
        writeFile(declarationPath, 'export declare function Navigate(): null;', 'utf8'),
        writeFile(runtimePath, 'export function Navigate() { return null; }', 'utf8'),
      ]);
      const inventory = await collectPreviewInspectorDirectRouteChoices({
        readSource: () => Promise.resolve(undefined),
        resolveModule: (specifier) =>
          specifier === 'react-router-dom' ? declarationPath : undefined,
        sourcePath: ownerPath,
        sourceText,
      });
      const resolution = await resolvePreviewInspectorDirectRouteChoices({
        choices: inventory.choices,
        identities: ['Navigate'],
        readSource: () => Promise.resolve(undefined),
      });
      const selected = resolution.selectable[0];

      expect(selected).toMatchObject({
        choice: {
          componentName: 'Navigate',
          reference: { exportName: 'Navigate', sourcePath: runtimePath },
        },
        evidenceKind: 'route-jsx',
        identityOrder: 0,
        pattern: '/my',
      });
      expect(JSON.parse(selected?.provenanceIdentity ?? '{}')).toMatchObject({
        componentExportName: 'Navigate',
        componentSourcePath: runtimePath,
      });
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it('totally partitions choices omitted from ranking identities', async () => {
    const choices = [
      createChoice('ranked', 'RankedPage', { pattern: '/ranked' }),
      createChoice('omitted', 'OmittedPage', { pattern: '/omitted' }),
      createChoice('duplicate-a', 'ExactPage', { pattern: '/exact' }),
      createChoice('duplicate-b', 'ExactPage', { pattern: '/exact' }),
      createChoice('conflict-a', 'ConflictPage', {
        pattern: '/conflict',
        referenceSourcePath: `${ROOT}/first-conflict.tsx`,
      }),
      createChoice('conflict-b', 'ConflictPage', {
        pattern: '/conflict',
        referenceSourcePath: `${ROOT}/second-conflict.tsx`,
      }),
      createChoice('missing-a', 'MissingPage', {
        evidence: Object.freeze({ kind: 'unresolved' }),
      }),
      createChoice('missing-b', 'MissingPage', {
        evidence: Object.freeze({ kind: 'unresolved' }),
      }),
    ];

    const resolution = await resolvePreviewInspectorDirectRouteChoices({
      choices,
      identities: ['RankedPage'],
      readSource: () => Promise.resolve(undefined),
    });

    expectTotalPartition(choices, resolution);
    expect(resolution.selectable.map((item) => item.choice.occurrenceIdentity)).toEqual([
      'ranked',
      'omitted',
      'duplicate-a',
    ]);
    expect(resolution.duplicates.map((item) => item.choice.occurrenceIdentity)).toEqual([
      'duplicate-b',
    ]);
    expect(
      resolution.unresolved
        .filter((item) => item.choice.componentName === 'ConflictPage')
        .map((item) => [item.choice.occurrenceIdentity, item.availability]),
    ).toEqual([
      ['conflict-a', 'route-provenance-ambiguous'],
      ['conflict-b', 'route-provenance-ambiguous'],
    ]);
    expect(
      resolution.unresolved
        .filter((item) => item.choice.componentName === 'MissingPage')
        .map((item) => item.choice.occurrenceIdentity),
    ).toEqual(['missing-a', 'missing-b']);
  });

  it('keeps component-base and bound-registry evidence occurrence-local', async () => {
    const featurePath = `${ROOT}/feature-app.tsx`;
    const registryPath = `${ROOT}/route-registry.ts`;
    const catalogPath = `${ROOT}/routes.json`;
    const unrelatedRegistryPath = `${ROOT}/unrelated-route-registry.ts`;
    const unrelatedCatalogPath = `${ROOT}/unrelated-routes.json`;
    const sources: Readonly<Record<string, string>> = {
      [featurePath]:
        'export const FeatureApp = createAppModule("/feature/:featureId(\\\\d+)", {}, [], () => <Routes />);',
      [registryPath]:
        'import routes from "./routes.json"; export const routeNamePathMap = invert(routes);',
      [catalogPath]: JSON.stringify({ bound: { index: 'BoundPage' } }),
      [unrelatedRegistryPath]:
        'import routes from "./unrelated-routes.json"; export const routeNamePathMap = invert(routes);',
      [unrelatedCatalogPath]: JSON.stringify({ unrelated: { index: 'UnrelatedPage' } }),
    };
    const baseEvidence: PreviewInspectorDirectRoutePathEvidence = Object.freeze({
      kind: 'component-base',
      reference: Object.freeze({
        exportName: 'FeatureApp',
        ownerSourcePath: OWNER_PATH,
        prefix: '',
        sourcePath: featurePath,
        suffix: '',
      }),
    });
    const catalogEvidence = (catalogKey: string): PreviewInspectorDirectRoutePathEvidence =>
      Object.freeze({
        kind: 'catalog-member',
        reference: Object.freeze({
          catalogKey,
          normalizerChain: Object.freeze(['normalize']),
          registryExportName: 'routeNamePathMap',
          registrySourcePath: registryPath,
        }),
      });
    const choices = [
      createChoice('base', 'FeatureApp', {
        evidence: baseEvidence,
        exportName: 'FeatureApp',
        referenceSourcePath: featurePath,
      }),
      createChoice('bound', 'BoundPage', { evidence: catalogEvidence('BoundPage') }),
      createChoice('unrelated', 'UnrelatedPage', {
        evidence: catalogEvidence('UnrelatedPage'),
      }),
    ];
    const resolution = await resolvePreviewInspectorDirectRouteChoices({
      choices,
      identities: [],
      readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
      resolveModule: (specifier, importer) =>
        new Map([
          [`${registryPath}\0./routes.json`, catalogPath],
          [`${unrelatedRegistryPath}\0./unrelated-routes.json`, unrelatedCatalogPath],
        ]).get(`${importer}\0${specifier}`),
    });

    expectTotalPartition(choices, resolution);
    expect(
      resolution.selectable.map((item) => [item.choice.occurrenceIdentity, item.pattern]),
    ).toEqual([
      ['base', '/feature/:featureId(\\d+)'],
      ['bound', '/bound'],
    ]);
    expect(
      resolution.unresolved.map((item) => [item.choice.occurrenceIdentity, item.availability]),
    ).toEqual([['unrelated', 'catalog-unresolved']]);
    expect(resolution.selectable[1]?.dependencyPaths).not.toContain(unrelatedRegistryPath);
    expect(resolution.selectable[1]?.dependencyPaths).not.toContain(unrelatedCatalogPath);
    expect(resolution.selectable[1]).toMatchObject({
      directRouteOwnerSourcePath: OWNER_PATH,
      sourcePath: catalogPath,
    });
  });
});

describe('contextual direct route target authority', () => {
  it('rejects a same-named contextual component from another source', async () => {
    const targetPath = `${ROOT}/selected-page.tsx`;
    const impostorPath = `${ROOT}/impostor-page.tsx`;
    const sources: Readonly<Record<string, string>> = {
      [CONTEXT_PATH]: [
        'import ExactTarget from "./selected-page";',
        'import SharedPage from "./impostor-page";',
        'const dynamicPath = () => "/selected";',
        '<Routes>',
        '  <Route path={dynamicPath()} element={<ExactTarget />} />',
        '  <Route path="/impostor" element={<SharedPage />} />',
        '</Routes>;',
      ].join('\n'),
      [targetPath]: 'export default function SharedPage() { return <main />; }',
      [impostorPath]: 'export default function SharedPage() { return <aside />; }',
    };
    const modulePaths: Readonly<Record<string, string>> = {
      './impostor-page': impostorPath,
      './selected-page': targetPath,
    };
    const inventory = await collectContextualInventory({
      modulePaths,
      sources,
      targetPath,
    });
    const contextualChoices = await collectPreviewInspectorDirectRouteChoices({
      readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
      resolveModule: (specifier) => modulePaths[specifier],
      sourcePath: CONTEXT_PATH,
      sourceText: sources[CONTEXT_PATH],
    });
    const contextualResolution = await resolvePreviewInspectorDirectRouteChoices({
      choices: contextualChoices.choices,
      identities: ['SharedPage'],
      readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
      resolveModule: (specifier) => modulePaths[specifier],
    });

    expectTotalPartition(contextualChoices.choices, contextualResolution);
    expect(inventory.primary).toBeUndefined();
    expectNoOwnerRows(inventory);
  });

  it('rejects a same-source contextual component with the wrong export', async () => {
    const targetPath = `${ROOT}/multi-export-page.tsx`;
    const sources: Readonly<Record<string, string>> = {
      [CONTEXT_PATH]: [
        'import { Alternate as SharedPage } from "./multi-export-page";',
        '<Routes><Route path="/alternate" element={<SharedPage />} /></Routes>;',
      ].join('\n'),
      [targetPath]: [
        'export default function SharedPage() { return <main />; }',
        'export function Alternate() { return <aside />; }',
      ].join('\n'),
    };
    const inventory = await collectContextualInventory({
      modulePaths: { './multi-export-page': targetPath },
      sources,
      targetPath,
    });

    expect(inventory.primary).toBeUndefined();
    expectNoOwnerRows(inventory);
  });

  it('selects the exact target over a higher-ranked same-named impostor', async () => {
    const targetPath = `${ROOT}/selected-page.tsx`;
    const impostorPath = `${ROOT}/impostor-page.tsx`;
    const sources: Readonly<Record<string, string>> = {
      [CONTEXT_PATH]: [
        'import ExactTarget from "./selected-page";',
        'import SharedPage from "./impostor-page";',
        '<Routes>',
        '  <Route path="/selected-page" element={<SharedPage />} />',
        '  <Route path="/zzz" element={<ExactTarget />} />',
        '</Routes>;',
      ].join('\n'),
      [targetPath]: 'export default function SharedPage() { return <main />; }',
      [impostorPath]: 'export default function SharedPage() { return <aside />; }',
    };
    const inventory = await collectContextualInventory({
      modulePaths: {
        './impostor-page': impostorPath,
        './selected-page': targetPath,
      },
      sources,
      targetPath,
    });

    expect(inventory.primary).toMatchObject({
      componentName: 'ExactTarget',
      componentSourcePath: targetPath,
      pattern: '/zzz',
    });
    expectNoOwnerRows(inventory);
  });

  it('accepts an exact target reference retained in the element wrapper path', async () => {
    const targetPath = `${ROOT}/target-wrapper.tsx`;
    const leafPath = `${ROOT}/leaf-page.tsx`;
    const sources: Readonly<Record<string, string>> = {
      [CONTEXT_PATH]: [
        'import TargetWrapper from "./target-wrapper";',
        'import LeafPage from "./leaf-page";',
        '<Routes>',
        '  <Route path="/wrapped" element={<TargetWrapper><LeafPage /></TargetWrapper>} />',
        '</Routes>;',
      ].join('\n'),
      [targetPath]:
        'export default function TargetWrapper({ children }) { return <main>{children}</main>; }',
      [leafPath]: 'export default function LeafPage() { return <article />; }',
    };
    const inventory = await collectContextualInventory({
      modulePaths: {
        './leaf-page': leafPath,
        './target-wrapper': targetPath,
      },
      sources,
      targetLabel: 'TargetWrapper',
      targetPath,
    });

    expect(inventory.primary).toMatchObject({
      componentName: 'LeafPage',
      componentSourcePath: leafPath,
      elementWrappers: [
        {
          componentName: 'TargetWrapper',
          exportName: 'default',
          sourcePath: targetPath,
        },
      ],
      pattern: '/wrapped',
    });
    expectNoOwnerRows(inventory);
  });
});

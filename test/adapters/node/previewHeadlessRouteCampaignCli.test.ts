import { describe, expect, it } from 'vitest';
import { parsePreviewHeadlessRouteCampaignArguments } from '../../../src/adapters/node/previewHeadlessRouteCampaignCli';

const REQUIRED_ARGUMENTS = [
  '--chromium',
  '/chromium',
  '--ledger',
  '/tmp/routes.jsonl',
  '--report',
  '/tmp/routes.json',
  '--target',
  '/workspace/App.tsx',
  '--workspace',
  '/workspace',
] as const;

describe('headless route campaign CLI controls', () => {
  it('parses a positive max and repeatable route IDs into durable normalized values', () => {
    const parsed = parsePreviewHeadlessRouteCampaignArguments([
      ...REQUIRED_ARGUMENTS,
      '--route-id',
      'third',
      '--max-routes',
      '4',
      '--route-id',
      'first',
    ]);

    expect(parsed.maxRoutes).toBe(4);
    expect(parsed.routeIds).toEqual(['first', 'third']);
  });

  it.each(['0', '-1', '1.5', '9007199254740992'])(
    'rejects invalid --max-routes value %s',
    (value) => {
      expect(() =>
        parsePreviewHeadlessRouteCampaignArguments([...REQUIRED_ARGUMENTS, '--max-routes', value]),
      ).toThrow('positive safe integer');
    },
  );

  it('rejects duplicate route IDs', () => {
    expect(() =>
      parsePreviewHeadlessRouteCampaignArguments([
        ...REQUIRED_ARGUMENTS,
        '--route-id',
        'first',
        '--route-id',
        ' first ',
      ]),
    ).toThrow('must not contain duplicates');
  });

  it('parses complete snapshot confinement identity with normalized dependency roots', () => {
    const parsed = parsePreviewHeadlessRouteCampaignArguments([
      ...REQUIRED_ARGUMENTS,
      '--source-root',
      '/snapshot/source',
      '--approved-dependency-root',
      '/installed/z',
      '--source-manifest-digest',
      'a'.repeat(64),
      '--approved-dependency-root',
      '/installed/a',
      '--dependency-view-digest',
      'b'.repeat(64),
      '--confinement-policy-digest',
      'c'.repeat(64),
    ]);

    expect(parsed.resolutionConfinement).toEqual({
      approvedDependencyRoots: ['/installed/a', '/installed/z'],
      dependencyViewDigest: 'b'.repeat(64),
      policyDigest: 'c'.repeat(64),
      sourceManifestDigest: 'a'.repeat(64),
      sourceRoot: '/snapshot/source',
    });
  });

  it('rejects partial or duplicate snapshot confinement roots', () => {
    expect(() =>
      parsePreviewHeadlessRouteCampaignArguments([
        ...REQUIRED_ARGUMENTS,
        '--source-root',
        '/snapshot/source',
      ]),
    ).toThrow('supplied together');
    expect(() =>
      parsePreviewHeadlessRouteCampaignArguments([
        ...REQUIRED_ARGUMENTS,
        '--source-root',
        '/snapshot/source',
        '--approved-dependency-root',
        '/installed',
        '--approved-dependency-root',
        '/installed',
        '--source-manifest-digest',
        'a'.repeat(64),
        '--dependency-view-digest',
        'b'.repeat(64),
        '--confinement-policy-digest',
        'c'.repeat(64),
      ]),
    ).toThrow('must not contain duplicates');
  });
});

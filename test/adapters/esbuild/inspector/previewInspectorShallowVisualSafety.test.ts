/** Keeps configuration values and inactive routes out of the executable page frame. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectPreviewInspectorShallowVisualEvidence,
  type PreviewInspectorShallowVisualEvidence,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorShallowVisualEvidence';

/** Resolves only fixture-local imports without reading or evaluating an application module. */
function collect(sourceText: string): PreviewInspectorShallowVisualEvidence['paths'] {
  return collectPreviewInspectorShallowVisualEvidence({
    importerPath: '/workspace/Owner.tsx',
    ownerExportName: 'default',
    selectedChildPath: '/workspace/Target.tsx',
    sourceText,
    resolveModule: (specifier) =>
      specifier.startsWith('.') ? path.resolve('/workspace', specifier + '.tsx') : undefined,
  }).paths;
}

const imports = `
import { Route, withRouter } from 'react-router-dom';
import Target from './Target'; import Header from './Header'; import Footer from './Footer';
import Permissions from './Permissions'; import OtherTab from './OtherTab';
import { Tab } from 'fixture-tabs';
`;

// Real tab-heavy pages can exhaust the bounded outcome tree before the selected route appears.
// The owner fallback must remain safe even though these repeated nodes have only one unique name.
const denseTabBar = `<div>${'<Tab />'.repeat(40)}</div>`;

describe('safe executable shallow page evidence', () => {
  it('keeps forest-root chrome beside the selected route without requiring owner fallback', () => {
    const paths = collect(`${imports}
      export default function Owner() {
        return <><Header /><Route path="/other"><OtherTab /></Route>
          <Route path="/selected"><Target /></Route><Footer /></>;
      }
    `);
    expect(
      paths.filter((item) => item.relation === 'sibling').map((item) => item.renderedLocalName),
    ).toEqual(['Header', 'Footer']);
    expect(
      paths.some(
        (item) => item.renderedLocalName === 'OtherTab' && item.relation !== 'route-alternative',
      ),
    ).toBe(false);
  });

  it('recovers trailing chrome after repeated component occurrences reach the tree budget', () => {
    const paths = collect(`${imports}
      export default function Owner() {
        return <><Header /><Route path="/selected"><Target /></Route>${denseTabBar}<Footer /></>;
      }
    `);
    expect([
      ...new Set(
        paths.filter((item) => item.relation === 'sibling').map((item) => item.renderedLocalName),
      ),
    ]).toEqual(['Header', 'Footer']);
  });

  it('does not turn a PascalCase enum read in a routed HOC owner into JSX', () => {
    const paths = collect(`${imports}
      const Owner = () => {
        const allowed = permissions.includes(Permissions.ReadRecords);
        return <>${denseTabBar}<Header /><Route path="/selected"><Target /></Route><Footer /></>;
      };
      export default withRouter(Owner);
    `);
    expect(paths.map((item) => item.renderedLocalName)).not.toContain('Permissions');
    expect(
      paths.filter((item) => item.relation === 'sibling').map((item) => item.renderedLocalName),
    ).toEqual(['Header', 'Footer']);
  });

  it.each([
    [
      'children',
      '<Route path="/other"><OtherTab /></Route>',
      '<Route path="/selected"><Target /></Route>',
    ],
    [
      'element',
      '<Route path="/other" element={<OtherTab />} />',
      '<Route path="/selected" element={<Target />} />',
    ],
    [
      'component',
      '<Route path="/other" component={OtherTab} />',
      '<Route path="/selected" component={Target} />',
    ],
    [
      'render callback',
      '<Route path="/other" render={() => <OtherTab />} />',
      '<Route path="/selected" render={() => <Target />} />',
    ],
  ])(
    'marks another %s route as an alternative, including HOC fallback evidence',
    (_kind, other, target) => {
      const paths = collect(`${imports}
      const Owner = () => <>${denseTabBar}<Header />${other}${target}<Footer /></>;
      export default withRouter(Owner);
    `);
      expect(
        paths.filter((item) => item.renderedLocalName === 'OtherTab').map((item) => item.relation),
      ).toEqual(['route-alternative']);
      expect(
        paths.filter((item) => item.relation === 'sibling').map((item) => item.renderedLocalName),
      ).toEqual(['Header', 'Footer']);
    },
  );

  it('does not discard the same component when a separate occurrence belongs to the selected route', () => {
    const paths = collect(`${imports}
      const Owner = () => <>${denseTabBar}<Route path="/other"><Header /></Route>
        <Route path="/selected"><Header /><Target /><Footer /></Route></>;
      export default withRouter(Owner);
    `);
    const headers = paths.filter((item) => item.renderedLocalName === 'Header');
    expect(headers.some((item) => item.relation === 'route-alternative')).toBe(true);
    expect(headers.some((item) => item.relation === 'sibling')).toBe(true);
    expect(
      paths.some((item) => item.renderedLocalName === 'Footer' && item.relation === 'sibling'),
    ).toBe(true);
  });

  it.each([
    ["import { Route as Branch, withRouter } from 'react-router-dom';", 'Branch'],
    [
      "import * as Router from 'react-router-dom'; const withRouter = Router.withRouter;",
      'Router.Route',
    ],
  ])('recognizes imported route aliases: %s', (routeImport, routeName) => {
    const paths =
      collect(`${imports.replace("import { Route, withRouter } from 'react-router-dom';", routeImport)}
      const Owner = () => <>${denseTabBar}<Header /><${routeName} path="/other"><OtherTab /></${routeName}>
        <${routeName} path="/selected"><Target /></${routeName}><Footer /></>;
      export default withRouter(Owner);
    `);
    expect(
      paths
        .filter((item) => item.renderedLocalName === 'OtherTab')
        .every((item) => item.relation === 'route-alternative'),
    ).toBe(true);
    expect(
      paths.some((item) => item.renderedLocalName === 'Header' && item.relation === 'sibling'),
    ).toBe(true);
  });

  it('keeps ancestors and same-route chrome while excluding a competing nested route', () => {
    const paths = collect(`${imports}
      const Owner = () => <Route path="/root">${denseTabBar}<Header /><Route path="selected"><Target /><Footer /></Route>
        <Route path="other"><OtherTab /></Route></Route>;
      export default withRouter(Owner);
    `);
    expect(
      paths.filter((item) => item.renderedLocalName === 'OtherTab').map((item) => item.relation),
    ).toEqual(['route-alternative']);
    expect(
      paths.filter((item) => item.relation === 'sibling').map((item) => item.renderedLocalName),
    ).toEqual(['Header', 'Footer']);
  });
});

/** Inert controlled sources for real-Router tests; no user modules or scripts are loaded. */
export const variableRouteFactorySources: Readonly<Record<string, string>> = {
  'package.json': String.raw`{"private": true, "dependencies": {"react": "18.3.1", "react-dom": "18.3.1", "react-router-dom": "6.30.1"}}
`,
  'src/app.tsx': String.raw`import React from 'react';
import { Route, Routes } from 'react-router-dom';
import { createAppModule } from './create-app-module';
import { ListPage } from './pages/list-page';
import { CreatePage } from './pages/create-page';
import { SiblingPage } from './pages/sibling-page';
import { ManagementApp } from './management/management-app';
import { AuditApp } from './audit-app';
import { NotFound } from './not-found';
export const FeatureApp = createAppModule('/feature', { ListPage, CreatePage, SiblingPage }, [ManagementApp, AuditApp],
 ({ entries: ownRoutes, branches: nestedRoutes }) => <main>OUTER_LAYOUT_MARKER<Routes>{ownRoutes}{nestedRoutes}<Route path="*" element={<NotFound />} /></Routes></main>);
`,
  'src/audit-app.tsx': String.raw`import { createAppModule } from './create-app-module';
import { AuditPage } from './audit-page';
export const AuditApp = createAppModule('/feature/audit', { AuditPage }, []);
`,
  'src/audit-page.tsx': String.raw`globalThis.__unusedAudit = 'SIBLING_AUDIT_MODULE_MARKER'; export function AuditPage() { return <p>UNSELECTED_AUDIT_MARKER</p>; }
`,
  'src/create-app-module-base.tsx': String.raw`import React from 'react';
import { Route } from 'react-router-dom';
const withProps = (injected) => (Component) => function Module(props) { return <Component {...props} {...injected} />; };
const relative = (base, absolute) => absolute === base ? '' : absolute.slice(base.length).replace(/^\//, '');
export const createAppModuleBase = (catalog) => (basePath, pages, subModules, Component) => {
 const App = withProps({
  entries: Object.entries(pages).map(([name, Page]) => <Route key={name} path={relative(basePath, catalog[name])} element={<Page />} />),
  branches: subModules.map((App) => <Route key={App.basePath} path={relative(basePath, App.basePath) + '/*'} element={<App />} />),
 })(Component);
 return Object.assign(App, { basePath, allPages: Object.values(pages), pageNames: Object.keys(pages) });
};
`,
  'src/create-app-module.ts': String.raw`import { createAppModuleBase } from './create-app-module-base';
import { pagePaths } from './page-map';
export const createAppModule = createAppModuleBase(pagePaths);
`,
  'src/management/detail-page.tsx': String.raw`import { useContext } from 'react';
import { useParams } from 'react-router-dom';
import { ManagedContext } from './provider';
export function DetailPage() { if (!useContext(ManagedContext)) throw new Error('Selected route lost authored Provider'); return <p>MANAGEMENT_DETAIL_MARKER:{useParams().id}</p>; }
`,
  'src/management/management-app.tsx': String.raw`import { ManagementProvider } from './provider';
import { Route, Routes } from 'react-router-dom';
import { createAppModule } from '../create-app-module';
import { DetailPage } from './detail-page';
import { SettingsPage } from './settings-page';
import { NotFound } from '../not-found';
export const ManagementApp = createAppModule('/feature/manage/:id', { DetailPage, SettingsPage }, [],
 ({ entries: ownRoutes }) => <section>INNER_LAYOUT_MARKER<ManagementProvider><Routes>{ownRoutes}<Route path="*" element={<NotFound />} /></Routes></ManagementProvider></section>);
`,
  'src/management/provider.tsx': String.raw`import React from 'react';
export const ManagedContext = React.createContext(false);
export function ManagementProvider({ children }) { return <ManagedContext.Provider value={true}><div data-audit-provider="true">INNER_PROVIDER_MARKER{children}</div></ManagedContext.Provider>; }
`,
  'src/management/settings-page.tsx': String.raw`globalThis.__unusedSettings = 'SIBLING_SETTINGS_MODULE_MARKER'; export function SettingsPage() { return <p>UNSELECTED_SETTINGS_MARKER</p>; }
`,
  'src/not-found.tsx': String.raw`export function NotFound() { return <p>NOT_FOUND_MARKER</p>; }
`,
  'src/page-map.ts': String.raw`import pages from './pages.json';
function invert(value, prefix = []) {
 return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
  const path = key === 'index' ? prefix : [...prefix, key];
  return typeof child === 'string' ? [[child, '/' + path.join('/')]] : Object.entries(invert(child, path));
 }));
}
export const pagePaths = invert(pages);
`,
  'src/pages/create-page.tsx': String.raw`export function CreatePage() { return <p>CREATE_PAGE_MARKER</p>; }
`,
  'src/pages/list-page.tsx': String.raw`export function ListPage() { return <p>LIST_PAGE_MARKER</p>; }
`,
  'src/pages/sibling-page.tsx': String.raw`globalThis.__unusedPage = 'SIBLING_MODULE_MARKER'; export function SiblingPage() { return <p>UNSELECTED_PAGE_MARKER</p>; }
`,
  'src/pages.json': String.raw`{"feature": {"index": "ListPage", "create": "CreatePage", "sibling": "SiblingPage", "manage": {":id": {"detail": "DetailPage", "settings": "SettingsPage"}}, "audit": {"index": "AuditPage"}}}
`,
};

/** Covers syntax behavior for previewInspectorRouteLocation. */
/** Verifies authored-source previewInspectorRouteLocation invariants. */
import { describe, expect, it } from 'vitest';

import { collectPreviewInspectorRouteLocation } from '../../../../src/adapters/esbuild/inspector';

import type { PreviewRenderChainPlan } from '../../../../src/adapters/esbuild/renderGraph';

import {
  APP_PATH,
  PAGE_CATALOG_PATH,
  PAGE_MAP_PATH,
  TARGET_PATH,
  createOptions,
  createRenderChain,
} from './previewInspectorRouteLocationFixtures';

describe('collectPreviewInspectorRouteLocation', () => {
  /** Mirrors a common generated page map where a guarded default export has a named local page. */
  it('reads a relative JSON page catalog and materializes dynamic parameters', async () => {
    const sources = {
      [TARGET_PATH]: [
        'function InvestmentContractAnalysisPage() { return <main />; }',
        'export default withGuard(InvestmentContractAnalysisPage);',
      ].join('\n'),
      [APP_PATH]: 'export function App() { return <main />; }',
      [PAGE_MAP_PATH]: 'import pages from "./pages.json"; export const pageMap = pages;',
      [PAGE_CATALOG_PATH]: JSON.stringify({
        company: {
          ':companyId(\\d+)': {
            'investment-contract-rtcc': { analysis: 'InvestmentContractAnalysisPage' },
          },
        },
      }),
    };

    const location = await collectPreviewInspectorRouteLocation(createOptions(sources));

    expect(location).toEqual({
      componentName: 'InvestmentContractAnalysisPage',
      dependencyPaths: [PAGE_CATALOG_PATH, PAGE_MAP_PATH].sort(),
      evidenceKind: 'route-catalog',
      pathname: '/company/1/investment-contract-rtcc/analysis',
      pattern: '/company/:companyId(\\d+)/investment-contract-rtcc/analysis',
      sourcePath: PAGE_CATALOG_PATH,
    });
  });

  /** Supports ordinary nested React Router JSX when a project has no static JSON route map. */
  it('joins nested JSX Route paths and materializes semantic identifier parameters', async () => {
    const routesPath = '/workspace/application/src/routes.tsx';
    const sources = {
      [TARGET_PATH]:
        'export default function InvestmentContractAnalysisPage() { return <main />; }',
      [routesPath]: [
        'import InvestmentContractAnalysisPage from "./pages/investment-contract-analysis-page";',
        'const routes = <Routes>',
        '  <Route path="/workspace/:workspaceId">',
        '    <Route path="analysis" element={<InvestmentContractAnalysisPage />} />',
        '  </Route>',
        '</Routes>;',
      ].join('\n'),
    };
    const renderChain = createRenderChain(routesPath);

    const location = await collectPreviewInspectorRouteLocation(
      createOptions(sources, renderChain),
    );

    expect(location).toMatchObject({
      evidenceKind: 'route-jsx',
      pathname: '/workspace/1/analysis',
      pattern: '/workspace/:workspaceId/analysis',
      sourcePath: routesPath,
    });
  });

  /** Prefers a target-near v5 child Route over the outer shell that merely owns `/patients`. */
  it('recognizes a component rendered as the child of a React Router v5 Route', async () => {
    const targetPath = '/workspace/application/src/patients/ViewCareGoal.tsx';
    const routesPath = '/workspace/application/src/HospitalRun.tsx';
    const sources = {
      [targetPath]: 'export default function ViewCareGoal() { return <form />; }',
      [routesPath]: [
        'import ViewCareGoal from "./patients/ViewCareGoal";',
        '<Switch>',
        '  <Route path="/patients" component={Patients} />',
        '  <Route path="/patients/:id/care-goals/:careGoalId">',
        '    <ViewCareGoal />',
        '  </Route>',
        '</Switch>',
      ].join('\n'),
    };
    const baseRenderChain = createRenderChain(routesPath, targetPath, 'ViewCareGoal');
    const basePath = baseRenderChain.paths[0];
    if (basePath === undefined) throw new Error('The route fixture requires one render path.');
    const renderChain: PreviewRenderChainPlan = {
      ...baseRenderChain,
      paths: [
        {
          ...basePath,
          steps: [
            {
              certainty: 'confirmed',
              kind: 'component-render',
              label: 'ViewCareGoal',
              occurrenceStart: 10,
              sourcePath: routesPath,
              wrapperNames: [],
            },
            {
              certainty: 'confirmed',
              kind: 'component-render',
              label: 'Patients',
              occurrenceStart: 30,
              sourcePath: routesPath,
              wrapperNames: [],
            },
          ],
        },
      ],
    };

    const location = await collectPreviewInspectorRouteLocation(
      createOptions(sources, renderChain),
    );

    expect(location).toMatchObject({
      componentName: 'ViewCareGoal',
      pathname: '/patients/1/care-goals/1',
      pattern: '/patients/:id/care-goals/:careGoalId',
      sourcePath: routesPath,
    });
  });

  /** Preserves a v5 page shell when the nearest route is delegated through PrivateRoute. */
  it('selects an imported component-style Route adapter before its broad page route', async () => {
    const targetPath =
      '/workspace/application/src/scheduling/appointments/AppointmentDetailForm.tsx';
    const editPath = '/workspace/application/src/scheduling/appointments/edit/EditAppointment.tsx';
    const appointmentsPath = '/workspace/application/src/scheduling/appointments/Appointments.tsx';
    const hospitalPath = '/workspace/application/src/HospitalRun.tsx';
    const privateRoutePath = '/workspace/application/src/shared/components/PrivateRoute.tsx';
    const sources = {
      [targetPath]: 'export default function AppointmentDetailForm() { return <form />; }',
      [editPath]: [
        'import AppointmentDetailForm from "../AppointmentDetailForm";',
        'export default function EditAppointment() { return <AppointmentDetailForm />; }',
      ].join('\n'),
      [appointmentsPath]: [
        'import PrivateRoute from "../../shared/components/PrivateRoute";',
        'import EditAppointment from "./edit/EditAppointment";',
        'import ViewAppointments from "./ViewAppointments";',
        '<Switch>',
        '  <PrivateRoute exact path="/appointments" component={ViewAppointments} />',
        '  <PrivateRoute exact path="/appointments/edit/:id" component={EditAppointment} />',
        '</Switch>;',
      ].join('\n'),
      [hospitalPath]: [
        'import Appointments from "./scheduling/appointments/Appointments";',
        '<Switch><Route path="/appointments" component={Appointments} /></Switch>;',
      ].join('\n'),
      [APP_PATH]: [
        'import HospitalRun from "./HospitalRun";',
        '<Switch><Route path="/" component={HospitalRun} /></Switch>;',
      ].join('\n'),
      [privateRoutePath]: [
        'import { Route } from "react-router-dom";',
        'export default function PrivateRoute({ component, ...rest }) {',
        '  return <Route {...rest} component={component} />;',
        '}',
      ].join('\n'),
      '/workspace/application/src/scheduling/appointments/ViewAppointments.tsx':
        'export default function ViewAppointments() { return <main />; }',
    };
    const renderChain: PreviewRenderChainPlan = {
      dependencyPaths: [targetPath, editPath, appointmentsPath, hospitalPath, APP_PATH],
      paths: [
        {
          entryPoint: {
            kind: 'create-root',
            occurrenceStart: 100,
            sourcePath: APP_PATH,
            wrapperNames: [],
          },
          id: 'hospital-appointment-edit-path',
          steps: [
            {
              certainty: 'confirmed',
              kind: 'component-render',
              label: 'AppointmentDetailForm (default)',
              occurrenceStart: 10,
              sourcePath: targetPath,
              wrapperNames: [],
            },
            {
              certainty: 'confirmed',
              kind: 'component-render',
              label: 'EditAppointment',
              occurrenceStart: 20,
              sourcePath: editPath,
              wrapperNames: [],
            },
            {
              certainty: 'confirmed',
              kind: 'component-render',
              label: 'Appointments',
              occurrenceStart: 30,
              sourcePath: appointmentsPath,
              wrapperNames: [],
            },
            {
              certainty: 'confirmed',
              kind: 'component-render',
              label: 'HospitalRun',
              occurrenceStart: 40,
              sourcePath: hospitalPath,
              wrapperNames: [],
            },
          ],
        },
      ],
      reachability: 'entry-connected',
      target: { exportName: 'default', sourcePath: targetPath },
      truncated: false,
    };

    const location = await collectPreviewInspectorRouteLocation(
      createOptions(sources, renderChain),
    );

    expect(location).toMatchObject({
      componentName: 'EditAppointment',
      pathname: '/appointments/edit/1',
      pattern: '/appointments/edit/:id',
      routeMounts: [
        { contextPattern: '/', sourcePath: hospitalPath },
        { contextPattern: '/appointments', sourcePath: appointmentsPath },
      ],
      sourcePath: appointmentsPath,
    });
  });

  /** Recovers the outer v5 route when the selected leaf is rendered inside its page component. */
  it('uses a proven routed render ancestor instead of the sibling catch-all route', async () => {
    const targetPath = '/workspace/application/src/Project/IssueCreate.tsx';
    const projectPath = '/workspace/application/src/Project/index.tsx';
    const routesPath = '/workspace/application/src/App/Routes.tsx';
    const pageErrorPath = '/workspace/application/src/PageError.tsx';
    const sources = {
      [targetPath]: 'export default function IssueCreate() { return <form />; }',
      [projectPath]: [
        'import IssueCreate from "./IssueCreate";',
        'export default function Project() {',
        '  return <Modal renderContent={() => <IssueCreate />} />;',
        '}',
      ].join('\n'),
      [routesPath]: [
        'import Project from "../Project/index";',
        'import PageError from "../PageError";',
        '<Switch>',
        '  <Route path="/project" component={Project} />',
        '  <Route component={PageError} />',
        '</Switch>;',
      ].join('\n'),
      [pageErrorPath]: 'export default function PageError() { return <main>error</main>; }',
    };
    const renderChain: PreviewRenderChainPlan = {
      dependencyPaths: [targetPath, projectPath, routesPath],
      paths: [
        {
          entryPoint: {
            kind: 'create-root',
            occurrenceStart: 100,
            sourcePath: routesPath,
            wrapperNames: [],
          },
          id: 'issue-create-path',
          steps: [
            {
              certainty: 'conditional',
              kind: 'route-branch',
              label: 'IssueCreate (default)',
              occurrenceStart: 20,
              sourcePath: targetPath,
              wrapperNames: ['Modal'],
            },
            {
              certainty: 'conditional',
              kind: 'route-branch',
              label: 'Project',
              occurrenceStart: 40,
              sourcePath: projectPath,
              wrapperNames: ['Route', 'Switch'],
            },
          ],
        },
      ],
      reachability: 'entry-connected',
      target: { exportName: 'default', sourcePath: targetPath },
      truncated: false,
    };

    const location = await collectPreviewInspectorRouteLocation(
      createOptions(sources, renderChain),
    );

    expect(location).toMatchObject({
      componentName: 'Project',
      componentSourcePath: projectPath,
      pathname: '/project',
      pattern: '/project',
      sourcePath: routesPath,
    });
  });

  /** Composes a relative JSX route with the absolute base authored by an app-module factory. */
  it('prepends an enclosing application module base path to a relative Route', async () => {
    const routesPath = '/workspace/application/src/feature-app.tsx';
    const sources = {
      [TARGET_PATH]:
        'export default function InvestmentContractAnalysisPage() { return <main />; }',
      [routesPath]: [
        'import InvestmentContractAnalysisPage from "./pages/investment-contract-analysis-page";',
        'const FEATURE_BASE_PATH = "/company/:companyId(\\\\d+)/contracts";',
        'export const FeatureApp = createAppModule(',
        '  FEATURE_BASE_PATH,',
        '  {},',
        '  [],',
        '  () => <Routes>',
        '    <Route path="analysis-preview" element={<InvestmentContractAnalysisPage />} />',
        '  </Routes>,',
        ');',
      ].join('\n'),
    };
    const renderChain = createRenderChain(routesPath);

    const location = await collectPreviewInspectorRouteLocation(
      createOptions(sources, renderChain),
    );

    expect(location).toMatchObject({
      evidenceKind: 'route-jsx',
      pathname: '/company/1/contracts/analysis-preview',
      pattern: '/company/:companyId(\\d+)/contracts/analysis-preview',
      sourcePath: routesPath,
    });
  });
});

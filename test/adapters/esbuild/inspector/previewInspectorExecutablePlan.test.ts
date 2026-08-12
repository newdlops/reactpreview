/** Verifies that VirtualPage narrowing never changes the current-file ownership identity. */
import { describe, expect, it } from 'vitest';
import {
  createPreviewInspectorExecutablePlan,
  type PreviewInspectorAncestorPlan,
} from '../../../../src/adapters/esbuild/inspector';

describe('preview Inspector executable plan', () => {
  /** Prevents alternate references from re-entering browser-side blocker and case selection. */
  it('keeps only the selected render path in both executable render-chain contracts', () => {
    const target = {
      exportName: 'TaxTypeBadge',
      sourcePath: '/workspace/meeting/tax-type-badge.tsx',
    };
    const pageRoot = {
      exportName: 'MeetingPaymentPage',
      sourcePath: '/workspace/meeting/meeting-payment-page.tsx',
    };
    const createRenderPath = (id: string, occurrenceStart: number) => ({
      id,
      steps: [
        {
          certainty: 'confirmed' as const,
          evidenceSourcePaths: [],
          invocation: {
            calleeName: 'TaxTypeBadge',
            mode: 'jsx' as const,
            sourcePath: pageRoot.sourcePath,
          },
          kind: 'component-render' as const,
          label: target.exportName,
          occurrenceStart,
          sourcePath: target.sourcePath,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed' as const,
          evidenceSourcePaths: [],
          kind: 'component-render' as const,
          label: pageRoot.exportName,
          occurrenceStart: 100,
          sourcePath: pageRoot.sourcePath,
          wrapperNames: [],
        },
      ],
    });
    const selectedRenderPath = createRenderPath('selected-tax-badge-use', 10);
    const alternateRenderPath = createRenderPath('alternate-tax-badge-use', 20);
    const renderChain = {
      dependencyPaths: [target.sourcePath, pageRoot.sourcePath],
      paths: [selectedRenderPath, alternateRenderPath],
      reachability: 'entry-connected' as const,
      target,
      truncated: false,
    };
    const candidate = {
      complete: true,
      dependencyPaths: [target.sourcePath, pageRoot.sourcePath],
      edges: [],
      id: 'meeting-payment-tax-badge',
      renderPath: selectedRenderPath,
      root: pageRoot,
      rootAutomaticProps: {},
      rootOwnsRouter: false,
      stopReason: 'root-reached' as const,
      target,
      targetAutomaticProps: {},
    };
    const plan: PreviewInspectorAncestorPlan = {
      ...candidate,
      pageCandidates: [candidate],
      renderChain,
      renderChainsByExport: { [target.exportName]: renderChain },
    };

    const executable = createPreviewInspectorExecutablePlan(plan, candidate.id);

    expect(executable.renderChain.paths).toEqual([selectedRenderPath]);
    expect(executable.renderChainsByExport[target.exportName]?.paths).toEqual([
      selectedRenderPath,
    ]);
    expect(executable.renderChainsByExport[target.exportName]).toBe(executable.renderChain);
  });

  /** Keeps a nested named export exact while a route barrel becomes the executable page root. */
  it('preserves a selected named export behind a virtualized route barrel', () => {
    const target = {
      exportName: 'InvestmentAgreementManagementPanel',
      sourcePath: '/workspace/pages/management/investment-agreement-management-panel.tsx',
    };
    const routeBarrel = '/workspace/pages/index.ts';
    const pagePath = '/workspace/pages/management/management-page.tsx';
    const appPath = '/workspace/app.tsx';
    const renderPath = {
      entryPoint: {
        kind: 'create-root' as const,
        occurrenceStart: 0,
        sourcePath: appPath,
        wrapperNames: [],
      },
      id: 'management-panel-path',
      steps: [
        {
          certainty: 'confirmed' as const,
          evidenceSourcePaths: [],
          invocation: {
            calleeName: target.exportName,
            mode: 'jsx' as const,
            sourcePath: pagePath,
          },
          kind: 'component-render' as const,
          label: target.exportName,
          occurrenceStart: 10,
          sourcePath: target.sourcePath,
          wrapperNames: [],
        },
        {
          certainty: 'conditional' as const,
          evidenceSourcePaths: [],
          invocation: {
            calleeName: 'RtccInvestmentContractManagementPage',
            mode: 'jsx' as const,
            sourcePath: routeBarrel,
          },
          kind: 'route-branch' as const,
          label: 'RtccInvestmentContractManagementPage',
          occurrenceStart: 20,
          sourcePath: pagePath,
          wrapperNames: [],
        },
        {
          certainty: 'conditional' as const,
          evidenceSourcePaths: [],
          kind: 'react-lazy' as const,
          label: 'RtccInvestmentContractManagementPage',
          occurrenceStart: 30,
          sourcePath: routeBarrel,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed' as const,
          evidenceSourcePaths: [],
          kind: 'entry-render' as const,
          label: 'App',
          occurrenceStart: 40,
          sourcePath: appPath,
          wrapperNames: [],
        },
      ],
    };
    const renderChain = {
      dependencyPaths: [target.sourcePath, pagePath, routeBarrel, appPath],
      paths: [renderPath],
      reachability: 'entry-connected' as const,
      target,
      truncated: false,
    };
    const candidate = {
      complete: true,
      dependencyPaths: [target.sourcePath, pagePath, routeBarrel, appPath],
      edges: [],
      id: 'named-export:InvestmentAgreementManagementPanel:route-choice',
      renderPath,
      root: { exportName: 'App', sourcePath: appPath },
      rootAutomaticProps: {},
      rootOwnsRouter: true,
      rootStepIndex: 3,
      routeLocation: {
        componentExportName: 'RtccInvestmentContractManagementPage',
        componentName: 'RtccInvestmentContractManagementPage',
        componentSourcePath: routeBarrel,
        dependencyPaths: [routeBarrel, pagePath],
        evidenceKind: 'route-catalog' as const,
        pathname: '/company/1/investment-contract-management',
        pattern: '/company/:companyId/investment-contract-management',
        sourcePath: appPath,
      },
      stopReason: 'root-reached' as const,
      target: {
        exportName: 'RtccInvestmentContractManagementPage',
        sourcePath: routeBarrel,
      },
      targetAutomaticProps: { companyId: '1' },
    };
    const plan: PreviewInspectorAncestorPlan = {
      ...candidate,
      pageCandidates: [candidate],
      renderChain,
      renderChainsByExport: { [target.exportName]: renderChain },
      target,
    };

    const executable = createPreviewInspectorExecutablePlan(plan, candidate.id);

    expect(executable.root).toEqual({
      exportName: 'RtccInvestmentContractManagementPage',
      sourcePath: routeBarrel,
    });
    expect(executable.target).toEqual(target);
    expect(Object.keys(executable.renderChainsByExport)).toEqual([target.exportName]);
    expect(executable.dependencyPaths).toEqual(
      expect.arrayContaining([target.sourcePath, routeBarrel]),
    );
  });

  /** Still permits an explicit scenario to select a different export from the current file. */
  it('preserves an alternate named-export scenario owned by the prepared target module', () => {
    const sourcePath = '/workspace/components/investment-contract-upload-panel.tsx';
    const primaryTarget = { exportName: 'UploadPanel', sourcePath };
    const selectedTarget = { exportName: 'UploadProgressPanel', sourcePath };
    const pageRoot = {
      exportName: 'ManagementPage',
      sourcePath: '/workspace/pages/management.tsx',
    };
    const primaryRenderChain = {
      dependencyPaths: [sourcePath, pageRoot.sourcePath],
      paths: [],
      reachability: 'entry-connected' as const,
      target: primaryTarget,
      truncated: false,
    };
    const selectedRenderChain = {
      ...primaryRenderChain,
      target: selectedTarget,
    };
    const selectedCandidate = {
      complete: true,
      dependencyPaths: [sourcePath, pageRoot.sourcePath],
      edges: [],
      id: 'named-export:UploadProgressPanel:management',
      root: pageRoot,
      rootAutomaticProps: {},
      rootOwnsRouter: false,
      stopReason: 'root-reached' as const,
      target: selectedTarget,
      targetAutomaticProps: {},
    };
    const plan: PreviewInspectorAncestorPlan = {
      ...selectedCandidate,
      pageCandidates: [selectedCandidate],
      renderChain: primaryRenderChain,
      renderChainsByExport: {
        [primaryTarget.exportName]: primaryRenderChain,
        [selectedTarget.exportName]: selectedRenderChain,
      },
      target: primaryTarget,
    };

    const executable = createPreviewInspectorExecutablePlan(plan, selectedCandidate.id);

    expect(executable.target).toEqual(selectedTarget);
    expect(Object.keys(executable.renderChainsByExport)).toEqual([selectedTarget.exportName]);
  });
});

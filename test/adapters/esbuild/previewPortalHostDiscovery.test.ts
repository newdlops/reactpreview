/** Exercises project-agnostic portal-host evidence without evaluating application modules. */
import { describe, expect, it } from 'vitest';
import {
  collectPreviewPortalHostIds,
  discoverPreviewPortalHostIds,
} from '../../../src/adapters/esbuild/previewPortalHostDiscovery';

describe('collectPreviewPortalHostIds', () => {
  /** Accepts an exact string lookup only when the module imports the real ReactDOM portal API. */
  it('collects literal ReactDOM portal host requirements', () => {
    const hostIds = collectPreviewPortalHostIds(
      '/workspace/src/modal.tsx',
      `
        import { createPortal as mountPortal } from 'react-dom';
        export function Modal({ children }) {
          const host = document.getElementById('modal-root');
          return host === null ? null : mountPortal(children, host);
        }
      `,
    );

    expect(hostIds).toEqual(['modal-root']);
  });

  /** Accepts only a selector that names one plain ID and cannot select descendants or attributes. */
  it('collects safe exact querySelector IDs and rejects compound selectors', () => {
    const hostIds = collectPreviewPortalHostIds(
      '/workspace/src/overlay.tsx',
      `
        import { createPortal } from 'react-dom';
        export function Overlay({ children }) {
          const host = document.querySelector('#overlay_root');
          document.querySelector('#overlay_root .content');
          document.querySelector('[data-overlay-root]');
          return host === null ? null : createPortal(children, host);
        }
      `,
    );

    expect(hostIds).toEqual(['overlay_root']);
  });

  /** Resolves enum-backed host groups used by reusable variable-ID portal components. */
  it('collects static enum array hosts rendered by a portal group', () => {
    const hostIds = collectPreviewPortalHostIds(
      '/workspace/src/Portal/index.tsx',
      `
        import ReactDOM from 'react-dom';
        export const Portal = ({ id, children }) => {
          const host = document.getElementById(id);
          return host === null ? null : ReactDOM.createPortal(children, host);
        };
        export enum PortalId {
          SHEET = 'bottom-sheet-root',
          TOAST = 'toast-root',
        }
        const portalOrder = [PortalId.SHEET, PortalId.TOAST];
        export const PortalGroup = () => (
          <>{portalOrder.map((id) => <div key={id} id={id} />)}</>
        );
      `,
    );

    expect(hostIds).toEqual(['bottom-sheet-root', 'toast-root']);
  });

  /** Leaves ordinary element queries missing so preview behavior does not invent page structure. */
  it('ignores non-portal DOM lookups and user-defined createPortal functions', () => {
    expect(
      collectPreviewPortalHostIds(
        '/workspace/src/layout.tsx',
        `
          const createPortal = (value) => value;
          export const readLayout = () => document.getElementById('page-layout');
          createPortal(readLayout());
        `,
      ),
    ).toEqual([]);
  });
});

describe('discoverPreviewPortalHostIds', () => {
  /** Reads only reached JS-like sources and returns stable de-duplicated host evidence. */
  it('discovers hosts across the selected dependency corridor', async () => {
    const sources = new Map([
      [
        '/workspace/src/portal.tsx',
        `import { createPortal } from 'react-dom';
         const host = document.getElementById('dialog-root');
         export const Dialog = ({ children }) => host && createPortal(children, host);`,
      ],
      ['/workspace/src/query.ts', `document.getElementById('ordinary-element');`],
    ]);

    await expect(
      discoverPreviewPortalHostIds({
        dependencyPaths: [...sources.keys(), '/workspace/src/ignored.css'],
        readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      }),
    ).resolves.toEqual(['dialog-root']);
  });

  /** Correlates a generic portal API with enum-backed DOM hosts authored in another reached file. */
  it('discovers portal hosts split across reached implementation and host modules', async () => {
    const portalPath = '/workspace/src/portal/Portal.tsx';
    const hostsPath = '/workspace/src/portal/PortalHosts.tsx';
    const sources = new Map([
      [
        portalPath,
        `import { createPortal } from 'react-dom';
         export enum PortalId { MODAL = 'modal-root', TOAST = 'toast-root' }
         export function Portal({ id, children }) {
           const host = document.getElementById(id);
           return host === null ? null : createPortal(children, host);
         }`,
      ],
      [
        hostsPath,
        `import { PortalId } from './Portal';
         const portalOrder = [PortalId.MODAL, PortalId.TOAST];
         export const PortalHosts = () => <>{portalOrder.map((id) => <div id={id} />)}</>;`,
      ],
    ]);

    await expect(
      discoverPreviewPortalHostIds({
        dependencyPaths: [...sources.keys()],
        readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      }),
    ).resolves.toEqual(['modal-root', 'toast-root']);
  });

  /** Uses one exact relative import seed instead of reading an entire large reached source graph. */
  it('bounds graph scanning and follows an exact lexical host module seed', async () => {
    const portalPath = '/workspace/src/runtime.tsx';
    const hostPath = '/workspace/src/infrastructure/hostRegistry.tsx';
    const fillerPaths = Array.from(
      { length: 400 },
      (_value, index) => `/workspace/src/features/feature-${index.toString()}.tsx`,
    );
    const sources = new Map<string, string>([
      [
        portalPath,
        `import { createPortal } from 'react-dom';
         import './infrastructure/hostRegistry';
         export const mount = (children, host) => createPortal(children, host);`,
      ],
      ...fillerPaths.map(
        (sourcePath) => [sourcePath, 'export const Feature = () => null;'] as const,
      ),
      [
        hostPath,
        `const portalRoots = ['bounded-portal-root'];
         export const HostRegistry = () => <>{portalRoots.map((id) => <div id={id} />)}</>;`,
      ],
    ]);
    const reads: { maximumBytes: number; sourcePath: string }[] = [];

    const hostIds = await discoverPreviewPortalHostIds({
      dependencyPaths: [portalPath, ...fillerPaths, hostPath],
      readSource: (sourcePath, maximumBytes) => {
        reads.push({ maximumBytes, sourcePath });
        return Promise.resolve(sources.get(sourcePath));
      },
    });

    expect(hostIds).toEqual(['bounded-portal-root']);
    expect(reads.map((read) => read.sourcePath)).toContain(hostPath);
    expect(reads).toHaveLength(65);
    expect(new Set(reads.map((read) => read.maximumBytes))).toEqual(new Set([256 * 1024]));
  });
});

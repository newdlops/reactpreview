/** Generates the optional project-owned @yarnpkg/libui Application preview boundary. */

/** Exact browser-resolved Application module selected from the target project. */
export interface PreviewYarnLibuiRuntimeSourceOptions {
  readonly applicationModulePath: string;
}

/** Wraps reached ministore consumers with the same public boundary used by libui renderForm. */
export function createPreviewYarnLibuiRuntimeSource(
  options: PreviewYarnLibuiRuntimeSourceOptions,
): string {
  const encodedApplicationPath = JSON.stringify(normalizeImportPath(options.applicationModulePath));
  return `
import * as React from 'react';
import * as ApplicationModule from ${encodedApplicationPath};

let consumesMinistore = false;
let ownsMinistore = false;
let registrationRevision = 0;
const registrationListeners = new Set();
let previewRuntimeStatus = 'available: libui ministore provider has not been requested';

/** Aggregates syntax-proven source evidence before the composed preview tree is created. */
export function registerPreviewYarnLibuiRequirement(requirement) {
  if (requirement === null || typeof requirement !== 'object') return;
  const nextConsumes = consumesMinistore || requirement.consumesMinistore === true;
  const nextOwns = ownsMinistore || requirement.ownsMinistore === true;
  if (nextConsumes === consumesMinistore && nextOwns === ownsMinistore) return;
  consumesMinistore = nextConsumes;
  ownsMinistore = nextOwns;
  registrationRevision += 1;
  for (const listener of registrationListeners) listener();
}

/** Subscribes one mounted boundary to requirements registered by later React.lazy chunks. */
function subscribeToRegistrations(listener) {
  registrationListeners.add(listener);
  return () => registrationListeners.delete(listener);
}

/** Preserves React 17 compatibility while closing the render-to-subscribe race. */
function useRegistrationRevision() {
  if (typeof React.useSyncExternalStore === 'function') {
    return React.useSyncExternalStore(
      subscribeToRegistrations,
      () => registrationRevision,
      () => registrationRevision,
    );
  }
  const [revision, setRevision] = React.useState(registrationRevision);
  React.useEffect(() => {
    const update = () => setRevision(registrationRevision);
    const unsubscribe = subscribeToRegistrations(update);
    update();
    return unsubscribe;
  }, []);
  return revision;
}

/** Resolves native ESM and CommonJS namespace layouts without importing a second package copy. */
function readApplication() {
  return ApplicationModule.Application ?? ApplicationModule.default?.Application ??
    (typeof ApplicationModule.default === 'function' ? ApplicationModule.default : undefined);
}

/** Resolves the current requirement snapshot inside a subscribed React component. */
function YarnLibuiSubscriptionBoundary({ children }) {
  useRegistrationRevision();
  if (!consumesMinistore) {
    previewRuntimeStatus = 'available: no reached libui ministore consumer requested a provider';
    return children;
  }
  if (ownsMinistore) {
    previewRuntimeStatus = 'active: reached source already owns the libui Application provider';
    return children;
  }
  const Application = readApplication();
  if (typeof Application !== 'function') {
    previewRuntimeStatus = 'unavailable: @yarnpkg/libui did not expose Application';
    return children;
  }
  previewRuntimeStatus = 'active: public @yarnpkg/libui Application provider composed';
  return React.createElement(Application, null, children);
}

/** Retains a lightweight boundary so lazy target chunks can activate the public provider later. */
export function createYarnLibuiPreviewElement(children) {
  return React.createElement(YarnLibuiSubscriptionBoundary, null, children);
}

/** Reports the latest automatic provider decision in runtime error diagnostics. */
export function readPreviewRuntimeStatus() {
  return previewRuntimeStatus;
}
`;
}

/** Produces a portable absolute ESM import path for generated browser source. */
function normalizeImportPath(modulePath: string): string {
  return modulePath.replaceAll('\\', '/');
}

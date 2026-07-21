/**
 * Generates the shared RouterContext consumed by legacy Next.js Pages Router internals.
 * Next Link and several framework helpers import this private context directly instead of calling
 * `useRouter`, so a preview-safe public router shim alone cannot reproduce the application shell.
 */

/** Creates one global-symbol-backed context shared by the public and private virtual modules. */
export function createPreviewNextPagesRouterContextRuntimeSource(): string {
  return `
import * as React from 'react';

const contextSymbol = Symbol.for('newdlops.react-file-preview.next-pages-router-context');
const existingContext = globalThis[contextSymbol];
export const RouterContext = existingContext !== null &&
  typeof existingContext === 'object' && existingContext.Provider !== undefined
  ? existingContext
  : React.createContext(null);
try { globalThis[contextSymbol] = RouterContext; } catch { /* isolated globals may be sealed */ }
RouterContext.displayName = RouterContext.displayName || 'ReactPreviewNextPagesRouterContext';
export default RouterContext;
`;
}

/**
 * Serializes syntax-proven React Context evidence into inert runtime bridge registrations.
 * Keeping this source generator separate from the general resource transformer preserves a clear
 * module boundary and prevents Context-specific code from growing the multi-resource adapter.
 */
import { PREVIEW_CONTEXT_SPECIFIER } from '../previewPluginProtocol';
import type { ReactContextHookFallbackTransform } from './reactContextHookFallback';
import type { ReactContextIdentityPair } from './reactContextIdentity';

/** Generated bridge import and inert registration calls appended to one reached source module. */
export interface ContextRegistrationStatements {
  /** At most one ESM import whose local bindings cannot collide with authored identifiers. */
  readonly imports: readonly string[];
  /** Identity registrations followed by demand-shaped hook requirement registrations. */
  readonly statements: readonly string[];
}

/** Allocates a generated binding already proven absent from the authored module. */
export type AllocateContextRegistrationBinding = (kind: string) => string;

/**
 * Connects local hook/Context identities and consumer fallback shapes at browser runtime.
 * Generated calls pass only already-bound functions, raw Context objects, and extension-owned
 * frozen fallback literals. They never import or invoke a conventionally named project Provider.
 *
 * @param identityPairs Same-module hook-to-Context pairs proven by syntax analysis.
 * @param fallbackTransform Demand shapes derived from reached imported hook calls.
 * @param allocateBinding Collision-free module binding allocator owned by the caller.
 * @returns One optional bridge import plus ordered registration statements.
 */
export function createContextRegistrationStatements(
  identityPairs: readonly ReactContextIdentityPair[],
  fallbackTransform: ReactContextHookFallbackTransform,
  allocateBinding: AllocateContextRegistrationBinding,
): ContextRegistrationStatements {
  if (identityPairs.length === 0 && fallbackTransform.registrations.length === 0) {
    return { imports: [], statements: [] };
  }

  const importedBindings: string[] = [];
  const statements: string[] = [];
  if (identityPairs.length > 0) {
    const identityBinding = allocateBinding('contextIdentity');
    importedBindings.push(`registerPreviewContextIdentity as ${identityBinding}`);
    for (const pair of identityPairs) {
      statements.push(`${identityBinding}(${pair.hookBinding}, ${pair.contextBinding});`);
    }
  }
  if (fallbackTransform.registrations.length > 0) {
    const requirementBinding = allocateBinding('contextRequirement');
    importedBindings.push(`registerPreviewContextRequirement as ${requirementBinding}`);
    for (const registration of fallbackTransform.registrations) {
      statements.push(
        `${requirementBinding}(${registration.hookExpression}, ${registration.fallbackBinding});`,
      );
    }
  }

  return {
    imports: [
      `import { ${importedBindings.join(', ')} } from ${JSON.stringify(PREVIEW_CONTEXT_SPECIFIER)};`,
    ],
    statements,
  };
}

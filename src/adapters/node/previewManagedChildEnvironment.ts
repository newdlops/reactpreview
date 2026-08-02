/** Builds the explicit environment inherited by preview-owned worker and browser processes. */
import { createHash } from 'node:crypto';

const DENIED_EXACT_VARIABLES = Object.freeze([
  'LD_AUDIT',
  'LD_LIBRARY_PATH',
  'LD_PRELOAD',
  'NODE_OPTIONS',
]);
const DENIED_VARIABLE_PREFIXES = Object.freeze(['DYLD_']);

/** Managed-child environment policy identity. Bump whenever sanitization semantics change. */
export const PREVIEW_MANAGED_CHILD_ENVIRONMENT_POLICY_VERSION = 2;

/** Stable policy identity that intentionally contains no environment values. */
export const PREVIEW_MANAGED_CHILD_ENVIRONMENT_POLICY_DIGEST = createHash('sha256')
  .update(
    JSON.stringify({
      deniedExactVariables: DENIED_EXACT_VARIABLES,
      deniedVariablePrefixes: DENIED_VARIABLE_PREFIXES,
      overrides: { PORT_MANAGER_HOOK: '0' },
      policyVersion: PREVIEW_MANAGED_CHILD_ENVIRONMENT_POLICY_VERSION,
    }),
  )
  .digest('hex');

/**
 * Copies one caller-supplied environment without dynamic-loader injection.
 *
 * Undefined entries are omitted because Node child environments accept only concrete string
 * values. The input and global process environment are never mutated.
 */
export function createPreviewManagedChildEnvironment(
  input: Readonly<NodeJS.ProcessEnv>,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(input)) {
    if (
      value === undefined ||
      DENIED_EXACT_VARIABLES.includes(name) ||
      DENIED_VARIABLE_PREFIXES.some((prefix) => name.startsWith(prefix))
    ) {
      continue;
    }
    environment[name] = value;
  }
  environment.PORT_MANAGER_HOOK = '0';
  return environment;
}

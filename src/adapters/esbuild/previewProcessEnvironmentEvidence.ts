/**
 * Classifies how one authored module reads `process.env` as evidence for server-only code.
 *
 * Bundlers inline only public build-time variables into browser code (`NODE_ENV`, `REACT_APP_*`,
 * `NEXT_PUBLIC_*`, `VITE_*`, ...), so a module that reads nothing else is ordinary client code such as
 * an API client. A private name (`DATABASE_URL`, `JWT_SECRET`), a computed key, or the whole object
 * may expose server configuration and stays strong server evidence.
 */

const PROCESS_ENVIRONMENT_ACCESS_PATTERN =
  /\bprocess\.env\b(?:\s*\??\.\s*([A-Za-z_$][\w$]*)|\s*(?:\?\.)?\s*\[\s*(["'])([^"'\\]*)\2\s*\])?/gu;
const PUBLIC_PROCESS_ENVIRONMENT_NAME_PATTERN =
  /^(?:NODE_ENV|(?:EXPO_PUBLIC|GATSBY|NEXT_PUBLIC|PUBLIC|REACT_APP|STORYBOOK|VITE)_[A-Z\d_]+)$/u;

/** `none`: no read; `public`: only public build-time names; `private`: anything else. */
export type PreviewProcessEnvironmentEvidence = 'none' | 'private' | 'public';

/** Reads every `process.env` access in one source text (comments included, conservatively). */
export function readPreviewProcessEnvironmentEvidence(
  sourceText: string,
): PreviewProcessEnvironmentEvidence {
  let evidence: PreviewProcessEnvironmentEvidence = 'none';
  for (const match of sourceText.matchAll(PROCESS_ENVIRONMENT_ACCESS_PATTERN)) {
    const name = match[1] ?? match[3];
    if (name === undefined || !PUBLIC_PROCESS_ENVIRONMENT_NAME_PATTERN.test(name)) {
      return 'private';
    }
    evidence = 'public';
  }
  return evidence;
}

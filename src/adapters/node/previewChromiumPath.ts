/** Discovers an installed Chromium-family browser without launching commands or searching PATH. */
import { existsSync } from 'node:fs';

/**
 * Returns the first existing explicit or conventional browser path, or undefined when unavailable.
 * The explicit CHROMIUM_PATH wins; bundled app executables avoid shell-wrapper side effects.
 */
export function discoverPreviewChromiumPath(
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): string | undefined {
  return [
    environment.CHROMIUM_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/opt/homebrew/bin/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].find((candidate) => candidate !== undefined && candidate.length > 0 && existsSync(candidate));
}

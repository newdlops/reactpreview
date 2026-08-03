/** Node globals required by bundled CommonJS dependencies in an ESM host. */
export const NODE_ESM_COMPATIBILITY_BANNER = [
  "import { createRequire as __reactPreviewCreateRequire } from 'node:module';",
  "import { fileURLToPath as __reactPreviewFileURLToPath } from 'node:url';",
  "import { dirname as __reactPreviewDirname } from 'node:path';",
  'const require = __reactPreviewCreateRequire(import.meta.url);',
  'const __filename = __reactPreviewFileURLToPath(import.meta.url);',
  'const __dirname = __reactPreviewDirname(__filename);',
].join('\n');

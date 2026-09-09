/** Generates owned browser outcome labels; no user source, profile, backend or network is accessed. */
import { buildSync } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOwnedBrowser } from './owned-browser.mjs';

const directory = process.argv[2];
const count = Number(process.argv[3] ?? 80);
if (!directory || !Number.isSafeInteger(count) || count < 8 || count > 160)
  throw new Error(
    'Usage: node scripts/neural-recovery/build-browser-corpus.mjs <directory> [8..160 cases per family]',
  );
const root = fileURLToPath(new URL('../../', import.meta.url));
const built = buildSync({
  stdin: {
    contents: `import { collectBrowserRecoveryCorpus } from './scripts/neural-recovery/browser-corpus-entry.mjs';
   collectBrowserRecoveryCorpus(${count}).then(result => globalThis.ownedCorpus = result)
     .catch(error => globalThis.ownedCorpus = { error: String(error) });`,
    resolveDir: root,
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  minify: true,
  write: false,
  define: { 'process.env.NODE_ENV': '"production"' },
});
const { result, profileDirectory } = await runOwnedBrowser(
  built.outputFiles[0].text,
  'ownedCorpus',
  240000,
);
await mkdir(resolve(directory), { recursive: true });
await writeFile(resolve(directory, 'browser-corpus.json'), JSON.stringify(result));
await writeFile(
  resolve(directory, 'browser-corpus-report.json'),
  JSON.stringify(
    {
      ...result.manifest,
      profileDirectory,
      splits: Object.fromEntries(
        Object.entries(result.splits).map(([key, cases]) => [key, cases.length]),
      ),
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ ...result.manifest, directory }, null, 2));

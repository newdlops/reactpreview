/**
 * Enforces the repository's hard 1,000-line limit for human-maintained project files.
 * Generated dependency manifests, build output, editor caches, and dependency folders are
 * excluded because contributors do not review or maintain their contents directly.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const MAXIMUM_LINES = 1000;
const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.codeidx',
  '.git',
  '.tmp',
  '.vscode',
  '.vscode-test',
  '.zoek-rs',
  'coverage',
  'dist',
  'node_modules',
]);
const EXCLUDED_FILE_NAMES = new Set(['.DS_Store']);
const BINARY_FILE_EXTENSIONS = new Set([
  '.avif',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.ttf',
  '.vsix',
  '.webp',
  '.woff',
  '.woff2',
]);

/** Identifies numbered local runtime captures, which are diagnostic input rather than source. */
function isRuntimeLogCapture(fileName) {
  return /^log(?:\d+)?\.txt$/u.test(fileName);
}

/**
 * Recursively collects regular files below a repository-relative directory.
 *
 * @param {string} directoryPath Repository-relative directory to inspect.
 * @returns {Promise<string[]>} Every regular file found below the directory.
 */
async function collectFiles(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return EXCLUDED_DIRECTORY_NAMES.has(entry.name) ? [] : collectFiles(entryPath);
      }

      if (
        EXCLUDED_FILE_NAMES.has(entry.name) ||
        isRuntimeLogCapture(entry.name) ||
        BINARY_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        return [];
      }

      return [entryPath];
    }),
  );

  return nestedFiles.flat();
}

/**
 * Counts physical lines so comments and blank lines count toward the architectural limit.
 *
 * @param {string} filePath Repository-relative file to read.
 * @returns {Promise<number>} Physical line count, treating an empty file as zero lines.
 */
async function countLines(filePath) {
  const contents = await readFile(filePath, 'utf8');
  if (contents.length === 0) {
    return 0;
  }

  const newlineCount = contents.match(/\n/gu)?.length ?? 0;
  return contents.endsWith('\n') ? newlineCount : newlineCount + 1;
}

/**
 * Checks every maintained file and exits with a readable list when a limit is exceeded.
 *
 * @returns {Promise<void>} A promise that resolves only when all files satisfy the limit.
 */
async function verifyFileLengths() {
  const candidateFiles = (await collectFiles('.')).sort();
  const violations = [];

  for (const filePath of candidateFiles) {
    const lineCount = await countLines(filePath);
    if (lineCount > MAXIMUM_LINES) {
      violations.push(`${filePath}: ${lineCount} lines`);
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `The ${MAXIMUM_LINES}-line limit was exceeded:\n${violations.map((item) => `- ${item}`).join('\n')}`,
    );
  }

  console.log(
    `Checked ${candidateFiles.length} maintained files (maximum ${MAXIMUM_LINES} lines).`,
  );
}

try {
  await verifyFileLengths();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

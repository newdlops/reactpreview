import { vi } from 'vitest';

/** Creates a writable workspace-state fake for PreviewController tests.
 * @param value Initial stored value.
 * @returns Fake state whose successful updates replace the stored value.
 */
export function createPreviewControllerTestWorkspaceState(value?: unknown): {
  get(key: string): unknown;
  update(key: string, next: unknown): Thenable<void>;
} {
  let stored = value;
  return {
    get: vi.fn((key: string): unknown => {
      void key;
      return stored;
    }),
    update: vi.fn((key: string, next: unknown) => {
      void key;
      stored = next;
      return Promise.resolve();
    }),
  };
}

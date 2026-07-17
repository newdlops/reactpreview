/** Test-only helpers for correlating fake browser hot-reload requests and acknowledgements. */

/** Correlation fields copied from an extension-to-webview hot-reload request. */
export interface HotReloadMessageIdentity {
  readonly revision: number;
  readonly token: string;
}

/** Test-only subset exposed by the fake VS Code webview panel. */
export interface TestPreviewPanel {
  readonly hotReloadMessages: readonly unknown[];
  readonly options: Record<string, unknown>;
  readonly title: string;
  readonly webview: { readonly html: string };
  acknowledgeHotReload(
    messageIndex: number,
    type?: 'react-preview-hot-reload-failed' | 'react-preview-hot-reload-ready',
  ): void;
  dispose(): void;
  failNextCommit(): void;
  focus(): void;
  holdHotReloadAcknowledgements(): void;
}

/** Reads exact correlation fields from a fake hot-reload message. */
export function readMessageIdentity(message: unknown): HotReloadMessageIdentity | undefined {
  return typeof message === 'object' &&
    message !== null &&
    'token' in message &&
    typeof message.token === 'string' &&
    'revision' in message &&
    typeof message.revision === 'number'
    ? { revision: message.revision, token: message.token }
    : undefined;
}

/** Creates the strict browser acknowledgement consumed by the real panel session. */
export function createAcknowledgement(
  identity: HotReloadMessageIdentity,
  type: string,
): Record<string, unknown> {
  const applied = type === 'react-preview-hot-reload-ready';
  return {
    applied,
    retainedPrevious: !applied,
    revision: identity.revision,
    token: identity.token,
    type,
  };
}

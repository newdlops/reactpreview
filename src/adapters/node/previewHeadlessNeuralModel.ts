/**
 * Seeds and captures the Page Inspector's profile neural model around one headless render, so
 * offline pre-training can carry learning from page to page the way a live panel shares it with
 * the extension host.
 *
 * Only the bounded model crosses this boundary: restored webview state holds nothing else, so
 * selections, overrides, and page candidates never leak between pages, and the captured value is
 * validated with the same reader the extension host applies to webview synchronization traffic.
 */
import {
  readPreviewInspectorNeuralModel,
  type PreviewInspectorNeuralModel,
} from '../../presentation/previewInspectorNeuralModelProtocol';

/** Webview state key under which the Page Inspector runtime restores its session. */
const PREVIEW_INSPECTOR_STATE_KEY = 'reactFilePreviewPageInspector';

/**
 * Renders the bridge's initial `getState()` value as a JavaScript expression.
 *
 * @param model Model to restore, or `undefined` for a fresh profile.
 * @returns Expression source; the model holds only finite numbers and hexadecimal keys.
 */
export function createPreviewHeadlessNeuralStateSource(
  model: PreviewInspectorNeuralModel | undefined,
): string {
  return model === undefined
    ? 'undefined'
    : JSON.stringify({ [PREVIEW_INSPECTOR_STATE_KEY]: { neuralResidualModel: model } });
}

/**
 * Validates the model captured from the page's last neural synchronization message.
 *
 * @param value Untrusted value from the browser payload.
 * @returns The normalized model, or `undefined` when absent or malformed.
 */
export function readPreviewHeadlessNeuralModel(
  value: unknown,
): PreviewInspectorNeuralModel | undefined {
  return value === undefined ? undefined : readPreviewInspectorNeuralModel(value);
}

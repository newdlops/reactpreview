/**
 * Creates the virtual browser entry module that mounts a current file's default export.
 * The generated module imports React from the user's project and dynamically loads a default-only
 * bridge so runtime failures remain visible while unused target exports can be tree-shaken.
 */
import { PREVIEW_TARGET_SPECIFIER } from './previewPluginProtocol';

/**
 * Builds a TSX-compatible runtime entry that loads the private target bridge.
 *
 * @returns JavaScript source consumed through esbuild's stdin entry point.
 */
export function createPreviewEntry(): string {
  const encodedTargetSpecifier = JSON.stringify(PREVIEW_TARGET_SPECIFIER);
  return `
import * as React from 'react';
import { createRoot } from 'react-dom/client';

const mountNode = document.getElementById('react-preview-root');
if (mountNode === null) {
  throw new Error('React Preview could not find its root element.');
}

/** Converts an unknown browser failure into readable stack or message text. */
function describeRuntimeError(error) {
  return error instanceof Error
    ? error.stack ?? error.message
    : String(error);
}

/** Replaces the preview root with inert text for module and unhandled runtime failures. */
function showRuntimeError(error) {
  const errorElement = document.createElement('pre');
  errorElement.className = 'react-preview-runtime-error';
  errorElement.textContent = describeRuntimeError(error);
  mountNode.replaceChildren(errorElement);
}

window.addEventListener('error', (event) => {
  showRuntimeError(event.error ?? event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  showRuntimeError(event.reason);
});

/** React boundary that keeps render and lifecycle exceptions visible inside the preview. */
class PreviewErrorBoundary extends React.Component {
  /** Creates a boundary with no captured error. */
  constructor(props) {
    super(props);
    this.state = { error: undefined };
  }

  /** Stores the error that React captured during descendant rendering. */
  static getDerivedStateFromError(error) {
    return { error };
  }

  /** Renders escaped error text or the original component children. */
  render() {
    if (this.state.error !== undefined) {
      const details = this.state.error instanceof Error
        ? this.state.error.stack ?? this.state.error.message
        : String(this.state.error);
      return React.createElement(
        'pre',
        { className: 'react-preview-runtime-error' },
        details,
      );
    }

    return this.props.children;
  }
}

import(${encodedTargetSpecifier})
  .then((previewModule) => {
    const PreviewTarget = previewModule.default;
    const previewElement = React.isValidElement(PreviewTarget)
      ? PreviewTarget
      : React.createElement(PreviewTarget);

    createRoot(mountNode).render(
      React.createElement(PreviewErrorBoundary, undefined, previewElement),
    );
  })
  .catch(showRuntimeError);
`;
}

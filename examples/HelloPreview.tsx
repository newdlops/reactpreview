/**
 * Minimal default-export component used for manual Extension Development Host verification.
 * It relies only on the repository's development React dependency and a neighboring CSS file.
 */
import './helloPreview.css';
import type { JSX } from 'react';

/**
 * Renders a self-contained card that makes typography and imported CSS easy to verify visually.
 *
 * @returns A static React element that requires no props, context, router, or backend.
 */
export default function HelloPreview(): JSX.Element {
  return (
    <section className="hello-preview">
      <span className="hello-preview__eyebrow">Serverless VS Code Webview</span>
      <h1>React File Preview is running.</h1>
      <p>Edit this text without saving—the preview should rebuild after a short delay.</p>
    </section>
  );
}

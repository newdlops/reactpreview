/**
 * Small React fixture used to verify real TSX, CSS, and workspace React dependency bundling.
 * It is not shipped with the extension and intentionally has no framework-specific build setup.
 */
import './samplePreview.css';
import styles from './samplePreview.module.css';
import type { JSX } from 'react';

/**
 * Renders stable fixture text that compiler tests can distinguish from an unsaved editor overlay.
 *
 * @returns A simple browser-renderable React element.
 */
export default function SamplePreview(): JSX.Element {
  return <article className={`sample-card ${styles.title ?? ''}`}>Saved fixture source</article>;
}

/** Correlates a published preview artifact with the browser operation that must apply it. */

/** Work origin retained until the browser confirms or rejects the associated application. */
export type PreviewPreparedApplicationOrigin =
  | {
      readonly buildRevision: number;
      readonly interactionId?: string;
      readonly kind: 'foreground';
      readonly requiresContextEnrichment: boolean;
    }
  | {
      readonly kind: 'context-enrichment';
      readonly owningRevision: number;
    };

/** Browser application disposition produced by publishing an artifact. */
export interface PreviewPreparedApplicationHandle {
  readonly applicationId: string;
  readonly disposition: 'already-displayed' | 'awaiting-hot-reload' | 'awaiting-runtime';
}

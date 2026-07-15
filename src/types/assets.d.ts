/**
 * Supplies editor-time types for style and binary imports used by test fixtures and manual examples.
 * Runtime handling remains owned by the esbuild adapter; these declarations execute no code and do
 * not impose a frontend framework or server on the extension host.
 */

/** Maps CSS Module class names to the scoped names emitted by esbuild's local-css loader. */
declare module '*.module.css' {
  const classNames: Readonly<Record<string, string>>;
  export default classNames;
}

/** Allows side-effect imports of global CSS during strict fixture type checking. */
declare module '*.css';

/** Exposes ordinary SVG imports as URLs plus a lightweight React image component adapter. */
declare module '*.svg' {
  const assetUrl: string;
  export default assetUrl;
  export const ReactComponent: import('react').ForwardRefExoticComponent<
    import('react').ImgHTMLAttributes<HTMLImageElement>
  >;
}

/** Exposes the `?react` SVG convention with the component as its default export. */
declare module '*.svg?react' {
  const ReactComponent: import('react').ForwardRefExoticComponent<
    import('react').ImgHTMLAttributes<HTMLImageElement>
  >;
  export default ReactComponent;
  export { ReactComponent };
  export const assetUrl: string;
}

/** Exposes any explicitly raw-imported file as its UTF-8 source text. */
declare module '*?raw' {
  const sourceText: string;
  export default sourceText;
}

/** Exposes explicitly URL-imported files as browser-ready data URLs. */
declare module '*?url' {
  const assetUrl: string;
  export default assetUrl;
}

/** Exposes APNG render assets as browser-ready data URLs. */
declare module '*.apng' {
  const assetUrl: string;
  export default assetUrl;
}

/** Exposes AVIF render assets as browser-ready data URLs. */
declare module '*.avif' {
  const assetUrl: string;
  export default assetUrl;
}

/** Exposes BMP render assets as browser-ready data URLs. */
declare module '*.bmp' {
  const assetUrl: string;
  export default assetUrl;
}

/** Exposes GIF render assets as browser-ready data URLs. */
declare module '*.gif' {
  const assetUrl: string;
  export default assetUrl;
}

/** Exposes icon render assets as browser-ready data URLs. */
declare module '*.ico' {
  const assetUrl: string;
  export default assetUrl;
}

/** Exposes JPEG render assets as browser-ready data URLs. */
declare module '*.jpeg' {
  const assetUrl: string;
  export default assetUrl;
}

/** Exposes JFIF render assets as browser-ready data URLs. */
declare module '*.jfif' {
  const assetUrl: string;
  export default assetUrl;
}

/** Exposes JPG render assets as browser-ready data URLs. */
declare module '*.jpg' {
  const assetUrl: string;
  export default assetUrl;
}

/** Exposes PNG render assets as browser-ready data URLs. */
declare module '*.png' {
  const assetUrl: string;
  export default assetUrl;
}

/** Exposes WebP render assets as browser-ready data URLs. */
declare module '*.webp' {
  const assetUrl: string;
  export default assetUrl;
}

/** Exposes EOT font assets as browser-ready data URLs. */
declare module '*.eot' {
  const assetUrl: string;
  export default assetUrl;
}

/** Exposes OTF font assets as browser-ready data URLs. */
declare module '*.otf' {
  const assetUrl: string;
  export default assetUrl;
}

/** Exposes TTF font assets as browser-ready data URLs. */
declare module '*.ttf' {
  const assetUrl: string;
  export default assetUrl;
}

/** Exposes WOFF font assets as browser-ready data URLs. */
declare module '*.woff' {
  const assetUrl: string;
  export default assetUrl;
}

/** Exposes WOFF2 font assets as browser-ready data URLs. */
declare module '*.woff2' {
  const assetUrl: string;
  export default assetUrl;
}

/** Exposes MP3 audio assets as browser-ready data URLs. */
declare module '*.mp3' {
  const assetUrl: string;
  export default assetUrl;
}

/** Exposes M4A audio assets as browser-ready data URLs. */
declare module '*.m4a' {
  const assetUrl: string;
  export default assetUrl;
}

/** Exposes OGG audio assets as browser-ready data URLs. */
declare module '*.ogg' {
  const assetUrl: string;
  export default assetUrl;
}

/** Exposes WAV audio assets as browser-ready data URLs. */
declare module '*.wav' {
  const assetUrl: string;
  export default assetUrl;
}

/** Exposes MP4 video assets as browser-ready data URLs. */
declare module '*.mp4' {
  const assetUrl: string;
  export default assetUrl;
}

/** Exposes WebM video assets as browser-ready data URLs. */
declare module '*.webm' {
  const assetUrl: string;
  export default assetUrl;
}

/** Exposes PDF document assets as browser-ready data URLs. */
declare module '*.pdf' {
  const assetUrl: string;
  export default assetUrl;
}

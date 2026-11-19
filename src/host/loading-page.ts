import { createHash } from 'node:crypto';

// The self-contained styles; system colors follow the browser's color scheme
const styles = `
  :root {
    color-scheme: light dark;
    font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: CanvasText;
    background: Canvas;
    line-height: 1.55;
  }

  body {
    margin: 0;
    min-height: 100vh;
    min-height: 100dvh;
    display: grid;
    place-items: center;
  }

  main {
    padding: 24px;
    text-align: center;
  }

  h1 {
    margin: 0 0 24px;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .spinner {
    width: 32px;
    height: 32px;
    margin: 0 auto;
    border: 3px solid color-mix(in srgb, currentColor 20%, transparent);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 900ms linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner { animation: none; }
  }
`;

// Allow only this stylesheet; scripts and external resources remain blocked
export const LOADING_PAGE_CSP = `default-src 'none'; frame-ancestors 'none'; style-src 'sha256-${createHash('sha256').update(styles).digest('base64')}'`;

// The temporary destination document shown until the stored session is restored
export const LOADING_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Preparing session transfer</title>
    <style>${styles}</style>
  </head>
  <body>
    <main role="status">
      <h1>Restoring stored session…</h1>
      <div class="spinner" aria-hidden="true"></div>
    </main>
  </body>
</html>`;

/**
 * Shown where a project has no photo yet: a flat tile with a building outline, drawn inline so
 * an empty listing never reaches out to a third-party image host.
 */
export const PROJECT_IMAGE_PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><rect width="160" height="100" fill="#eef0f2"/>` +
      `<g fill="none" stroke="#b4bcc7" stroke-width="2" stroke-linejoin="round"><path d="M58 76V36l22-10v50M80 76V44l22 8v24M50 76h60"/>` +
      `<path d="M66 42h6M66 52h6M66 62h6M88 56h6M88 66h6"/></g></svg>`
  );

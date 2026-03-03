// Publication manifest URLs for the Readium Playground library.
// Books hosted on the self-hosted Railway publication server (manus-wcp-production.up.railway.app)
// are served from EPUBs stored in the server/epubs/ directory of garethmul/manus-wcp.
// To add a new book: add the EPUB to server/epubs/, commit and push to trigger a Railway redeploy,
// then add the entry here using the base64url-encoded filename as the path segment.
//
// Base64url encoding: echo -n "filename.epub" | base64 | tr '+/' '-_' | tr -d '='
//
// Self-hosted server: https://manus-wcp-production.up.railway.app
// GitHub repo: https://github.com/garethmul/manus-wcp

const RAILWAY_SERVER = "https://manus-wcp-production.up.railway.app";

export const PUBLICATION_MANIFESTS = {
  // Self-hosted on Railway (garethmul/manus-wcp → server/epubs/)
  "alice-in-wonderland": `${RAILWAY_SERVER}/webpub/YWxpY2UuZXB1Yg/manifest.json`,
  "frankenstein": `${RAILWAY_SERVER}/webpub/ZnJhbmtlbnN0ZWluLmVwdWI/manifest.json`,
  "moby-dick": `${RAILWAY_SERVER}/webpub/bW9ieS1kaWNrLmVwdWI/manifest.json`,
  "the-house-of-seven-gables": `${RAILWAY_SERVER}/webpub/aG91c2Utb2Ytc2V2ZW4tZ2FibGVzLmVwdWI/manifest.json`,
  "les-diaboliques": `${RAILWAY_SERVER}/webpub/bGVzLWRpYWJvbGlxdWVzLmVwdWI/manifest.json`,
  "religions-war-terror": `${RAILWAY_SERVER}/webpub/UmVsaWdpb25zLXdhci10ZXJyb3IuZXB1Yg/manifest.json`,
  // Hosted on official Readium server (proprietary EPUB, not self-hosted)
  "bella-the-dragon": "https://publication-server.readium.org/webpub/Z3M6Ly9yZWFkaXVtLXBsYXlncm91bmQtZmlsZXMvZGVtby9CZWxsYU9yaWdpbmFsMy5lcHVi/manifest.json",
} as const;

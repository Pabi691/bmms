// Vercel serverless entry point. Vercel auto-detects any file under /api
// as a function and invokes the default export as a (req, res) handler —
// an Express app satisfies that shape directly, so we just re-export it.
export { default } from '../server/src/index.js';

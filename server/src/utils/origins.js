/** Comma-separated list of trusted frontend origins, e.g. "https://app.example.com". */
export function getAllowedOrigins() {
  return (process.env.CLIENT_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

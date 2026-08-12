// Next.js's bundler strips "server-only" to a no-op on the server and only
// keeps its throw for client bundles. Plain Node (vitest) has neither
// behavior, so it always throws — alias it to this stub for tests instead.
export {};

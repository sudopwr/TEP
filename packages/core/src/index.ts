/**
 * packages/core — the domain.
 *
 * Zero runtime dependencies, by design and by lint rule. Nothing in here
 * may import from outside this directory: no Fastify, no SQLite, no React,
 * not even `node:*`. Anything the outside world must provide arrives as a
 * port interface defined here and implemented in apps/api.
 */
export {};

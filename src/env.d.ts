/// <reference types="astro/client" />

// Cloudflare Workers bindings (defined in wrangler.jsonc)
// In Astro v6, use `import { env } from 'cloudflare:workers'` to access bindings.
interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  IMAGES: ImagesBinding;
  RATE_LIMIT: KVNamespace;
  OAUTH_RELAY_URL?: string;
  HUB_CONNECTOR_DEFAULT_EXCHANGE_URL?: string;
  MANAGED_PROVIDER_CONFIG_URL?: string;
  MANAGED_PROVIDER_USAGE_ENDPOINT?: string;
  MANAGED_PROVIDER_INSTANCE_ID?: string;
}

// Cloudflare Workers types augmentation
declare module 'cloudflare:workers' {
  interface Env {
    DB: D1Database;
    BUCKET: R2Bucket;
    ASSETS: Fetcher;
    IMAGES: ImagesBinding;
    RATE_LIMIT: KVNamespace;
    OAUTH_RELAY_URL?: string;
    HUB_CONNECTOR_DEFAULT_EXCHANGE_URL?: string;
    MANAGED_PROVIDER_CONFIG_URL?: string;
    MANAGED_PROVIDER_USAGE_ENDPOINT?: string;
    MANAGED_PROVIDER_INSTANCE_ID?: string;
  }
}

// Authenticated admin info (populated by middleware from
// `admin_users` after a verified session-cookie hit).
interface User {
  id: string;
  email: string;
  role: string;
  created_at: string;
  last_login_at: string | null;
}

declare namespace App {
  interface Locals {
    user: User | null;
    /**
     * Active workspace for this request. Always present — middleware
     * sets it to DEFAULT_WORKSPACE for both protected and public
     * routes. Used by db queries to scope reads / writes.
     */
    workspace_id: string;
  }
}

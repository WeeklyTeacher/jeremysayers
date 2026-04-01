// /home/r_/projects/jeremysayers/src/env.d.ts
/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

declare namespace App {
  interface Locals {
    runtime?: {
      env?: {
        DB_JEREMYSAYERS?: D1Database;
      };
    };
  }
}

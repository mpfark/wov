/** Local typechecking only. The HTTPS import resolves to the existing installed SDK's types. */
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response> | Response): void;
};
declare module 'https://esm.sh/@supabase/supabase-js@2.116.0' {
  import { createClient as installedCreateClient } from '@supabase/supabase-js';
  export const createClient: typeof installedCreateClient;
}

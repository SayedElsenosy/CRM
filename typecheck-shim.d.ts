declare module 'npm:@supabase/supabase-js@2' { export function createClient(...args: any[]): any; }
declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void };
declare const EdgeRuntime: { waitUntil(task: Promise<unknown>): void };

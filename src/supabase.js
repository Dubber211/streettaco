import { createClient } from "@supabase/supabase-js";

// Trim to defend against stray whitespace/newlines in env vars
// (some hosting dashboards introduce a trailing \n on paste, which
// breaks the Realtime websocket because the apikey query param ends
// up containing %0A).
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL.trim(),
  import.meta.env.VITE_SUPABASE_ANON_KEY.trim()
);

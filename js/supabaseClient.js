// supabaseClient.js — one shared Supabase client, imported by any page that needs it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Replace these with your project's own values (Settings → API in Supabase).
const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-KEY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

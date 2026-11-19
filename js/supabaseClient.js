// supabaseClient.js — one shared Supabase client, imported by any page that needs it.
// The library is kept inside the app (js/vendor/supabase.js), so every page starts without waiting on another website.
import { createClient } from "./vendor/supabase.js";

// Replace these with your project's own values (Settings → API in Supabase).
const SUPABASE_URL = "https://dfqqubmilzwlkzpqnvvs.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRmcXF1Ym1pbHp3bGt6cHFudnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5ODIyOTEsImV4cCI6MjEwNTU1ODI5MX0.AGGIhET9ENHYGBDIqxaJ_tRQRi-SQdjEA4EB4KmPWg4";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

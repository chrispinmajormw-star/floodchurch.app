// site-settings.js — the church-wide text the dashboard can edit (home banner,
// service times, address, quick giving, contact details). If the table isn't
// there yet, the original wording is used so nothing on screen changes.
import { supabase } from "./supabaseClient.js";

export const SITE_DEFAULTS = {
  hero_tag: "LIVE SUNDAY",
  hero_headline: "Bringing upcoming generations to Christ for transformation.",
  service_times: "Sunday 9:00 am · Sunday 11:00 am",
  service_address: "Kaunda Street, Area 47, Opposite Gateway Mall, Lilongwe",
  service_day: 0,
  service_hour: 9,
  quick_giving_text: "Give your tithe or offering in seconds with Mpamba, Airtel Money or card.",
  quick_giving_cta: "Give now",
  contact_email: "",
  contact_phone: "",
};

export async function getSiteSettings() {
  try {
    const { data, error } = await supabase.from("site_settings").select("*").eq("id", 1).maybeSingle();
    if (error || !data) return { ...SITE_DEFAULTS };
    const clean = {};
    Object.keys(SITE_DEFAULTS).forEach((k) => {
      clean[k] = data[k] ?? SITE_DEFAULTS[k];
    });
    return clean;
  } catch (e) {
    return { ...SITE_DEFAULTS };
  }
}

// components/edit-profile.js — lets the signed-in user update their profile
// (name/group/team) and change their password.
import { bootApp } from "../App.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";

export async function renderEditProfile() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ back: true, backHref: "profile.html", rightIcon: null, title: "Edit Profile" });

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", authUser.id)
    .maybeSingle();

  document.getElementById("name").value = profile?.name || "";
  document.getElementById("group").value = profile?.group_name || "";
  document.getElementById("team").value = profile?.team || "";

  // --- Profile form ---
  const profileForm = document.getElementById("profile-form");
  const profileError = document.getElementById("profile-error");
  const profileSuccess = document.getElementById("profile-success");
  const profileSubmit = document.getElementById("profile-submit");

  profileForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    profileError.classList.remove("show");
    profileSuccess.classList.remove("show");

    const name = document.getElementById("name").value.trim();
    const group_name = document.getElementById("group").value.trim();
    const team = document.getElementById("team").value.trim();

    profileSubmit.disabled = true;
    profileSubmit.textContent = "Saving…";

    const { error } = await supabase.from("profiles").upsert({
      id: authUser.id,
      name,
      group_name,
      team,
      avatar_initial: name ? name[0].toUpperCase() : profile?.avatar_initial || "?",
    });

    profileSubmit.disabled = false;
    profileSubmit.textContent = "Save changes";

    if (error) {
      profileError.textContent = error.message;
      profileError.classList.add("show");
      return;
    }
    profileSuccess.textContent = "Profile updated.";
    profileSuccess.classList.add("show");
  });

  // --- Password form ---
  const passwordForm = document.getElementById("password-form");
  const passwordError = document.getElementById("password-error");
  const passwordSuccess = document.getElementById("password-success");
  const passwordSubmit = document.getElementById("password-submit");

  passwordForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    passwordError.classList.remove("show");
    passwordSuccess.classList.remove("show");

    const newPassword = document.getElementById("new-password").value;
    const confirmPassword = document.getElementById("confirm-password").value;

    if (newPassword !== confirmPassword) {
      passwordError.textContent = "Passwords don't match.";
      passwordError.classList.add("show");
      return;
    }

    passwordSubmit.disabled = true;
    passwordSubmit.textContent = "Updating…";

    const { error } = await supabase.auth.updateUser({ password: newPassword });

    passwordSubmit.disabled = false;
    passwordSubmit.textContent = "Update password";

    if (error) {
      passwordError.textContent = error.message;
      passwordError.classList.add("show");
      return;
    }
    passwordSuccess.textContent = "Password updated.";
    passwordSuccess.classList.add("show");
    passwordForm.reset();
  });
}

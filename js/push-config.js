// push-config.js — paste your VAPID *public* key here.
//
// How to get one (run this on your own computer, in PowerShell):
//     npx web-push generate-vapid-keys
// It prints a Public Key and a Private Key.
//   • The PUBLIC key goes below. It is safe to commit to GitHub.
//   • The PRIVATE key never goes in this repo. It is stored only as a
//     Supabase secret (see the setup steps that came with this update).
export const VAPID_PUBLIC_KEY = "PASTE-VAPID-PUBLIC-KEY-HERE";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { supabaseConfig } from "./supabase-config.js";

export const supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey);

export function signInWithEmail(email) {
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
}

export function signOut() {
  return supabase.auth.signOut();
}

export function watchAuth(callback) {
  // onAuthStateChange fires immediately with the current session (event
  // INITIAL_SESSION) on subscribe, so a separate getSession() call here
  // would double-fire the callback on every load.
  const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
  return () => sub.subscription.unsubscribe();
}

const { createClient } = require("@supabase/supabase-js");

const getSupabaseConfig = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase URL oder Publishable Key fehlt.");
  }

  return { supabaseUrl, supabaseKey };
};

const createSupabaseClient = () => {
  const { supabaseUrl, supabaseKey } = getSupabaseConfig();

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
};

const createSupabaseAdminClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
};

// Gibt zusätzlich die aktuelle Session zurück. Ist der Access-Token abgelaufen,
// erneuert Supabase ihn dabei; die neuen Tokens müssen dann in die Cookies.
const createSupabaseClientForSession = async (accessToken, refreshToken) => {
  const supabase = createSupabaseClient();

  if (!accessToken || !refreshToken) {
    return { supabase, session: null, error: null };
  }

  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  return { supabase, session: error ? null : data.session, error };
};

// Netzwerk- oder Serverprobleme bei Supabase, im Gegensatz zu ungültigen Zugangsdaten.
const isSupabaseUnavailable = (error) =>
  Boolean(error) &&
  (error.name === "AuthRetryableFetchError" || error.status === 0 || error.status >= 500 || /fetch failed/i.test(error.message || ""));

module.exports = {
  createSupabaseClient,
  createSupabaseAdminClient,
  createSupabaseClientForSession,
  isSupabaseUnavailable,
};

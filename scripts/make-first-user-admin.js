const { loadEnvFile } = require("../utils/env");
const { createSupabaseAdminClient } = require("../utils/supabase-node");

loadEnvFile();

const run = async () => {
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY fehlt in .env.local.");
  }

  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });

  if (error) {
    throw error;
  }

  const user = data.users[0];

  if (!user) {
    throw new Error("Kein Supabase-User gefunden.");
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...(user.app_metadata || {}),
      role: "admin",
    },
  });

  if (updateError) {
    throw updateError;
  }

  console.log(`Admin gesetzt: ${user.email}`);
};

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

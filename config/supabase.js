const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

class DummyWebSocket {}
const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: {
    transport: DummyWebSocket,
  },
});

module.exports = supabase;

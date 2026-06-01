const { pool } = require('./config/db');

async function inspect() {
  try {
    const res = await pool.query("SELECT * FROM chat_history WHERE type = 'result' ORDER BY created_at DESC LIMIT 5");
    console.log("=== RECENT DIAGNOSIS RESULTS ===");
    for (const row of res.rows) {
      console.log(`ID: ${row.id} | Session: ${row.session_id} | Risk: ${row.risk_level} | Burnout: ${row.burnout_score}`);
      console.log(`Rec: ${row.recommendation}`);
      console.log(`Created: ${row.created_at}`);
      console.log('---');
    }
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

inspect();

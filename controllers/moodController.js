const { pool } = require('../config/db');

exports.getMoods = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM moods WHERE user_id = $1 ORDER BY date DESC', [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.createMood = async (req, res) => {
  const { date, mood_type, note } = req.body;
  if (!date || !mood_type) return res.status(400).json({ error: 'Date and mood_type are required' });

  try {
    const query = `
      INSERT INTO moods (user_id, date, mood_type, note) 
      VALUES ($1, $2, $3, $4)
      ON CONFLICT(user_id, date) DO UPDATE SET 
        mood_type = EXCLUDED.mood_type, 
        note = EXCLUDED.note
      RETURNING id
    `;
    
    const result = await pool.query(query, [req.user.id, date, mood_type, note || '']);
    res.json({ message: 'Mood saved successfully', id: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

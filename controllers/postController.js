const { pool } = require('../config/db');
const mlService = require('../services/mlService');

exports.getPosts = async (req, res) => {
  try {
    const query = `
      SELECT posts.id, posts.content, posts.created_at, posts.channel_slug, users.username 
      FROM posts 
      JOIN users ON posts.user_id = users.id 
      ORDER BY posts.created_at DESC
    `;
    const result = await pool.query(query);
    
    const formattedRows = result.rows.map(row => ({
      ...row,
      username: row.username.substring(0, 3) + '***'
    }));
    
    res.json(formattedRows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.createPost = async (req, res) => {
  const { content, channel_slug } = req.body;
  if (!content) return res.status(400).json({ error: 'Content is required' });

  try {
    const validation = await mlService.checkSentiment(content);
    if (!validation.is_appropriate) {
      return res.status(400).json({ 
        error: 'Postingan ditolak karena mengandung kata-kata yang dinilai tidak sopan atau kurang pantas. Mari jaga Ruang Aman ini tetap kondusif. 💚' 
      });
    }

    const result = await pool.query(
      'INSERT INTO posts (user_id, content, channel_slug) VALUES ($1, $2, $3) RETURNING id, created_at',
      [req.user.id, content, channel_slug || 'curhat-umum']
    );
    res.status(201).json({ 
      id: result.rows[0].id, 
      content, 
      channel_slug: channel_slug || 'curhat-umum',
      user_id: req.user.id, 
      username: req.user.username.substring(0, 3) + '***',
      created_at: result.rows[0].created_at 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.getChannels = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM channels ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

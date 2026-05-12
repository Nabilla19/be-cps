const { pool } = require('../config/db');

exports.getPosts = async (req, res) => {
  try {
    const query = `
      SELECT posts.id, posts.content, posts.created_at, users.username 
      FROM posts 
      JOIN users ON posts.user_id = users.id 
      ORDER BY posts.created_at DESC
    `;
    const result = await pool.query(query);
    
    const formattedRows = result.rows.map(row => ({
      ...row,
      username: 'User_' + row.username.substring(0, 3) + '***'
    }));
    
    res.json(formattedRows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.createPost = async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'Content is required' });

  try {
    const result = await pool.query(
      'INSERT INTO posts (user_id, content) VALUES ($1, $2) RETURNING id, created_at',
      [req.user.id, content]
    );
    res.status(201).json({ 
      id: result.rows[0].id, 
      content, 
      user_id: req.user.id, 
      username: 'User_' + req.user.username.substring(0, 3) + '***',
      created_at: result.rows[0].created_at 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

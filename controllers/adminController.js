const { pool } = require('../config/db');
const bcrypt = require('bcryptjs');

exports.getStats = async (req, res) => {
  try {
    const userCount = await pool.query('SELECT COUNT(*) FROM users');
    const postCount = await pool.query('SELECT COUNT(*) FROM posts');
    res.json({
      users: parseInt(userCount.rows[0].count),
      posts: parseInt(postCount.rows[0].count)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.getPosts = async (req, res) => {
  try {
    const query = `
      SELECT posts.id, posts.content, posts.created_at, users.username 
      FROM posts 
      JOIN users ON posts.user_id = users.id 
      ORDER BY posts.created_at DESC
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.deletePost = async (req, res) => {
  try {
    await pool.query('DELETE FROM posts WHERE id = $1', [req.params.id]);
    res.json({ message: 'Post deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.bulkDeletePosts = async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Post IDs are required' });
  }
  try {
    await pool.query('DELETE FROM posts WHERE id = ANY($1::int[])', [ids]);
    res.json({ message: 'Selected posts deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.createChannel = async (req, res) => {
  const { slug, name, description } = req.body;
  if (!slug || !name) return res.status(400).json({ error: 'Slug and Name are required' });

  // Clean slug
  const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9-_]/g, '-');

  try {
    const result = await pool.query(
      'INSERT INTO channels (slug, name, description) VALUES ($1, $2, $3) RETURNING *',
      [cleanSlug, name, description || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Channel with this slug already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.deleteChannel = async (req, res) => {
  const { slug } = req.params;
  if (slug === 'curhat-umum') {
    return res.status(400).json({ error: 'Cannot delete the default general channel' });
  }
  try {
    // Delete all posts in this channel first
    await pool.query('DELETE FROM posts WHERE channel_slug = $1', [slug]);
    
    // Delete the channel
    const result = await pool.query('DELETE FROM channels WHERE slug = $1 RETURNING *', [slug]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Channel not found' });
    
    res.json({ message: 'Channel and its posts deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.getUsers = async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const userId = req.params.id;
    await pool.query('DELETE FROM moods WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM posts WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.makeAdmin = async (req, res) => {
  try {
    const result = await pool.query("UPDATE users SET role = 'admin' WHERE username = $1 RETURNING id", [req.params.username]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ message: `User ${req.params.username} is now an admin` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.addUser = async (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, username, role',
      [username, email || null, hashedPassword, role || 'user']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Username or Email already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.updateUserRole = async (req, res) => {
  const { role } = req.body;
  const { id } = req.params;
  try {
    const result = await pool.query("UPDATE users SET role = $1 WHERE id = $2 RETURNING id, username, role", [role, id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User role updated successfully', user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

// GET /api/admin/analytics - mood distribution + 7-day trend + posts-per-day
exports.getAnalytics = async (req, res) => {
  try {
    // Mood distribution across ALL users
    const moodDist = await pool.query(`
      SELECT mood_type, COUNT(*) as count
      FROM moods
      GROUP BY mood_type
    `);

    // Mood trend: last 7 days
    const moodTrend = await pool.query(`
      SELECT 
        date,
        SUM(CASE WHEN mood_type = 'happy'   THEN 1 ELSE 0 END) AS happy,
        SUM(CASE WHEN mood_type = 'neutral' THEN 1 ELSE 0 END) AS neutral,
        SUM(CASE WHEN mood_type = 'sad'     THEN 1 ELSE 0 END) AS sad
      FROM moods
      WHERE date >= TO_CHAR(CURRENT_DATE - INTERVAL '6 days', 'YYYY-MM-DD')
      GROUP BY date
      ORDER BY date ASC
    `);

    // Posts per day: last 7 days
    const postsPerDay = await pool.query(`
      SELECT 
        TO_CHAR(created_at, 'YYYY-MM-DD') AS date,
        COUNT(*) AS count
      FROM posts
      WHERE created_at >= NOW() - INTERVAL '6 days'
      GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD')
      ORDER BY date ASC
    `);

    // User registrations per day: last 7 days
    const userGrowth = await pool.query(`
      SELECT 
        TO_CHAR(created_at, 'YYYY-MM-DD') AS date,
        COUNT(*) AS count
      FROM users
      WHERE created_at >= NOW() - INTERVAL '6 days'
      GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD')
      ORDER BY date ASC
    `);

    res.json({
      moodDistribution: moodDist.rows,
      moodTrend: moodTrend.rows,
      postsPerDay: postsPerDay.rows,
      userGrowth: userGrowth.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};


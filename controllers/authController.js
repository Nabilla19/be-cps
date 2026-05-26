const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { SECRET_KEY } = require('../middleware/authMiddleware');

exports.register = async (req, res) => {
  const { username, email, password, birth_date, gender } = req.body;
  if (!username || !email || !password || !birth_date || !gender) {
    return res.status(400).json({ error: 'Username, email, password, tanggal lahir, dan jenis kelamin wajib diisi' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, email, password, birth_date, gender) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [username, email, hashedPassword, birth_date, gender]
    );
    res.status(201).json({ message: 'User registered successfully', userId: result.rows[0].id });
  } catch (err) {
    if (err.code === '23505') {
      if (err.constraint && err.constraint.includes('email')) {
        return res.status(400).json({ error: 'Email already exists' });
      }
      return res.status(400).json({ error: 'Username already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.login = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'Invalid username or password' });

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: 'Invalid username or password' });

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET_KEY, { expiresIn: '24h' });
    res.json({ message: 'Logged in successfully', token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, email, birth_date, gender, role FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.updateProfile = async (req, res) => {
  const { username, email, password, birth_date, gender } = req.body;
  const userId = req.user.id;
  try {
    let query = 'UPDATE users SET username = $1, email = $2, birth_date = $3, gender = $4';
    let values = [username, email, birth_date, gender, userId];
    
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      query += ', password = $6 WHERE id = $5 RETURNING id, username, email, birth_date, gender, role';
      values.push(hashedPassword);
    } else {
      query += ' WHERE id = $5 RETURNING id, username, email, birth_date, gender, role';
    }
    
    const result = await pool.query(query, values);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    res.json({ message: 'Profile updated successfully', user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Username or Email already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

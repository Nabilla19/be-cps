const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/mindease',
});

const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    try { await pool.query('ALTER TABLE users ADD COLUMN email VARCHAR(255) UNIQUE'); } catch (e) {}
    try { await pool.query("ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'user'"); } catch (e) {}
    try { await pool.query("ALTER TABLE users ADD COLUMN birth_date VARCHAR(50)"); } catch (e) {}
    try { await pool.query("ALTER TABLE users ADD COLUMN gender VARCHAR(50)"); } catch (e) {}
    
    // Create channels table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS channels (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seed initial channels if table is empty
    const seedCount = await pool.query('SELECT COUNT(*) FROM channels');
    if (parseInt(seedCount.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO channels (slug, name, description) VALUES
        ('curhat-umum', '💬-curhat-umum', 'Saluran bebas untuk membagikan keluh kesah dan cerita apa saja.'),
        ('stres-kecemasan', '🧠-stres-kecemasan', 'Tempat berbagi cerita seputar stres, kepanikan, dan kecemasan Anda.'),
        ('insomnia-tidur', '🌙-insomnia-tidur', 'Mengalami masalah tidur? Yuk, saling bercerita dan berbagi tips di sini.'),
        ('pelukan-hangat', '🫂-pelukan-hangat', 'Bila sedang sedih atau terluka, dapatkan pelukan hangat dan simpati di sini.')
      `);
      console.log('Seeded initial channels successfully');
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add channel_slug column to posts table
    try { 
      await pool.query("ALTER TABLE posts ADD COLUMN channel_slug VARCHAR(255) DEFAULT 'curhat-umum'"); 
    } catch (e) {}

    await pool.query(`
      CREATE TABLE IF NOT EXISTS moods (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        date VARCHAR(50) NOT NULL,
        mood_type VARCHAR(50) NOT NULL,
        note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, date)
      )
    `);
    console.log('Connected to PostgreSQL and verified tables');
  } catch (err) {
    console.error('Error initializing PostgreSQL tables', err);
  }
};

module.exports = { pool, initDB };

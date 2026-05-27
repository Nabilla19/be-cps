const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const dbPath = path.resolve(__dirname, '../database.sqlite');
const db = new sqlite3.Database(dbPath);

const pool = {
  query: (text, params) => {
    return new Promise((resolve, reject) => {
      // Convert $1, $2 to ? for sqlite3
      let sqliteText = text.replace(/\$\d+/g, '?');
      
      // Convert some Postgres specific types to SQLite types
      sqliteText = sqliteText
        .replace(/SERIAL PRIMARY KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
        .replace(/TIMESTAMP DEFAULT CURRENT_TIMESTAMP/gi, "DATETIME DEFAULT CURRENT_TIMESTAMP")
        .replace(/NUMERIC\(\d+,\s*\d+\)/gi, "REAL");

      db.all(sqliteText, params || [], function (err, rows) {
        if (err) return reject(err);
        resolve({ rows: rows || [], rowCount: this.changes || (rows ? rows.length : 0) });
      });
    });
  }
};

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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        setting_key VARCHAR(255) UNIQUE NOT NULL,
        setting_value TEXT NOT NULL
      )
    `);

    // Insert default settings if they don't exist
    try {
      await pool.query(`INSERT INTO settings (setting_key, setting_value) VALUES ('dashboard_greeting', 'Bagaimana perasaanmu hari ini? Yuk ceritakan.') ON CONFLICT (setting_key) DO NOTHING`);
      await pool.query(`INSERT INTO settings (setting_key, setting_value) VALUES ('ai_prompt', 'Kamu adalah asisten AI yang ramah dan empatik untuk kesehatan mental. Berikan jawaban yang menenangkan dan suportif.') ON CONFLICT (setting_key) DO NOTHING`);
    } catch (e) { console.error('Error inserting default settings:', e); }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS doctors (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        spec VARCHAR(255) NOT NULL,
        exp VARCHAR(50) NOT NULL,
        rating NUMERIC(2, 1) DEFAULT 5.0,
        reviews INTEGER DEFAULT 0,
        available BOOLEAN DEFAULT true,
        tags TEXT -- stored as comma-separated string
      )
    `);

    // Insert default doctors if table is empty
    const doctorsCount = await pool.query('SELECT COUNT(*) FROM doctors');
    if (parseInt(doctorsCount.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO doctors (name, spec, exp, rating, reviews, available, tags) VALUES 
        ('Dr. Budi Santoso, M.Psi', 'Konselor Akademik Kampus', '8 Tahun', 4.9, 214, true, 'Kecemasan Skripsi,Burnout,Manajemen Waktu'),
        ('Rina Oktavia, M.Psi', 'Psikolog Dewasa Muda', '5 Tahun', 4.8, 156, true, 'Quarter Life Crisis,Homesick,Depresi'),
        ('Dr. Sarah Wijaya, Sp.KJ', 'Psikiater Mahasiswa', '10 Tahun', 5.0, 312, false, 'ADHD,Gangguan Tidur,Stres Ujian')
      `);
    }

    // Create chat_sessions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        title VARCHAR(255) DEFAULT 'Obrolan Baru',
        risk_level VARCHAR(50) DEFAULT '-',
        burnout_score REAL DEFAULT 0.0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create chat_history table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        session_id INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE,
        sender VARCHAR(50) NOT NULL,
        text TEXT,
        type VARCHAR(50) DEFAULT 'text',
        risk_level VARCHAR(50),
        burnout_score REAL,
        recommendation TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Alter chat_history table if it already existed but didn't have session_id
    try {
      await pool.query(`
        ALTER TABLE chat_history ADD COLUMN session_id INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE
      `);
      console.log('Successfully altered chat_history table to add session_id column');
    } catch (e) {
      // Column might already exist, safe to ignore
    }

    console.log('Connected to PostgreSQL/SQLite and verified tables');
  } catch (err) {
    console.error('Error initializing PostgreSQL tables', err);
  }
};

module.exports = { pool, initDB };

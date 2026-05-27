const Groq = require('groq-sdk');
const { pool } = require('../config/db');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const CHAT_MODEL = 'llama-3.3-70b-versatile'; // Model terbaik di Groq, gratis & cepat

// Helper: Parse JSON dari respons LLM dengan aman
function safeParseJSON(text) {
  if (!text || text.trim() === '') return null;
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
  cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch (e2) { return null; }
    }
    return null;
  }
}

exports.chatAgent = async (req, res) => {
  try {
    const { message, currentState, session_id } = req.body;

    // Perekaman pesan user ke database (hanya jika pengguna sedang login)
    if (req.user && session_id) {
      try {
        await pool.query(
          "INSERT INTO chat_history (user_id, session_id, sender, text, type) VALUES ($1, $2, $3, $4, $5)",
          [req.user.id, session_id, 'user', message, 'text']
        );
      } catch (dbErr) {
        console.error("Gagal merekam chat user ke DB:", dbErr.message);
      }
    }

    const nullFeatures = Object.entries(currentState || {})
      .filter(([, v]) => v === null)
      .map(([k]) => k);

    const nextQuestion = nullFeatures.length > 0 ? nullFeatures[0] : null;

    const systemPrompt = `Kamu adalah "MindEase AI", teman curhat yang empatik untuk mahasiswa Indonesia.

TUGASMU:
1. Balas dengan empati dan hangat (2-3 kalimat bahasa Indonesia).
2. ${nextQuestion ? `Di akhir, selipkan pertanyaan NATURAL untuk menggali info tentang: "${nextQuestion}"` : 'Beritahu user bahwa datanya sudah lengkap dan akan segera dianalisis.'}
3. Dari pesan user, ekstrak nilai untuk fitur berikut JIKA disebutkan:
   - age (umur, angka)
   - gender (Male/Female/Other)
   - academic_year (tahun kuliah 1-4, angka)
   - study_hours_per_day (jam belajar per hari, angka)
   - exam_pressure (tekanan ujian 0-10, angka)
   - academic_performance (nilai akademik 0-100, angka)
   - stress_level (level stres 0-10, angka)
   - anxiety_score (skor kecemasan 0-10, angka)
   - depression_score (skor depresi 0-10, angka)
   - sleep_hours (jam tidur per hari, angka)
   - physical_activity (jam olahraga per minggu, angka)
   - social_support (dukungan sosial 0-10, angka)
   - screen_time (jam layar per hari, angka)
   - internet_usage (jam internet per hari, angka)
   - financial_stress (tekanan finansial 0-10, angka)
   - family_expectation (ekspektasi keluarga 0-10, angka)
   - sleep_category (Cukup/Kurang/Baik)
   - screen_time_category (Normal/Tinggi)
   - stress_category (Low/Medium/High)
   - mental_risk_score (skor risiko mental 0-10, angka)
   - support_category (Low Support/High Support)

PENTING: Hanya balas dengan JSON murni, tidak ada teks lain:
{"reply": "balasan empati kamu", "extractedFeatures": {"nama_fitur": nilai}}`;

    // Membangun context percakapan (riwayat chat) untuk dikirim ke Groq Llama
    const groqMessages = [
      { role: 'system', content: systemPrompt }
    ];

    if (req.user && session_id) {
      try {
        // Ambil 10 pesan terakhir secara kronologis dari database khusus sesi ini
        const historyResult = await pool.query(
          "SELECT sender, text FROM chat_history WHERE user_id = $1 AND session_id = $2 AND type = 'text' ORDER BY created_at DESC LIMIT 10",
          [req.user.id, session_id]
        );

        const historyRows = historyResult.rows.reverse();

        historyRows.forEach(row => {
          groqMessages.push({
            role: row.sender === 'user' ? 'user' : 'assistant',
            content: row.text
          });
        });
      } catch (dbErr) {
        console.error("Gagal memuat konteks riwayat chat:", dbErr.message);
        groqMessages.push({ role: 'user', content: message });
      }
    } else {
      groqMessages.push({ role: 'user', content: message });
    }

    let result = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const completion = await groq.chat.completions.create({
          model: CHAT_MODEL,
          messages: groqMessages,
          response_format: { type: 'json_object' },
          temperature: 0.7,
          max_tokens: 1024,
        });

        const rawText = completion.choices[0]?.message?.content || '';
        result = safeParseJSON(rawText);

        if (result && result.reply) break;
        console.warn(`Attempt ${attempt}: JSON tidak valid:`, rawText.substring(0, 200));

      } catch (err) {
        console.error(`Attempt ${attempt} error:`, err.message);
        if (attempt < 3) await new Promise(r => setTimeout(r, 500 * attempt));
      }
    }

    if (!result || !result.reply) {
      return res.json({
        reply: "Aku dengar kamu kok. Ceritakan lebih lanjut, aku ada di sini untukmu. 💙",
        extractedFeatures: {}
      });
    }

    // Sanitasi extractedFeatures: hapus nilai null/undefined/kosong
    const cleanFeatures = {};
    if (result.extractedFeatures) {
      for (const [key, val] of Object.entries(result.extractedFeatures)) {
        if (val !== null && val !== undefined && val !== '') {
          cleanFeatures[key] = val;
        }
      }
    }

    // Perekaman pesan balasan AI ke database (hanya jika pengguna sedang login)
    if (req.user && session_id && result.reply) {
      try {
        await pool.query(
          "INSERT INTO chat_history (user_id, session_id, sender, text, type) VALUES ($1, $2, $3, $4, $5)",
          [req.user.id, session_id, 'ai', result.reply, 'text']
        );
      } catch (dbErr) {
        console.error("Gagal merekam chat AI ke DB:", dbErr.message);
      }
    }

    res.json({
      reply: result.reply,
      extractedFeatures: cleanFeatures
    });

  } catch (error) {
    console.error("chatAgent Fatal Error:", error);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
};

exports.getChatHistory = async (req, res) => {
  try {
    const { session_id } = req.query;

    if (!session_id) {
      return res.status(400).json({ error: 'session_id is required' });
    }

    const result = await pool.query(
      "SELECT * FROM chat_history WHERE user_id = $1 AND session_id = $2 ORDER BY created_at ASC",
      [req.user.id, session_id]
    );

    const formattedHistory = result.rows.map(row => {
      if (row.type === 'result') {
        return {
          id: row.id,
          sender: row.sender,
          type: 'result',
          riskLevel: row.risk_level,
          burnoutScore: row.burnout_score,
          recommendation: row.recommendation
        };
      }
      return {
        id: row.id,
        sender: row.sender,
        text: row.text
      };
    });

    res.json(formattedHistory);
  } catch (err) {
    console.error("Error getChatHistory:", err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.saveChatResult = async (req, res) => {
  try {
    const { riskLevel, burnoutScore, recommendation, session_id } = req.body;

    if (!riskLevel || burnoutScore === undefined || !recommendation || !session_id) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const result = await pool.query(
      "INSERT INTO chat_history (user_id, session_id, sender, type, risk_level, burnout_score, recommendation) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [req.user.id, session_id, 'ai', 'result', riskLevel, parseFloat(burnoutScore), recommendation]
    );

    // Update status diagnosis sesi di tabel chat_sessions agar ter-update di dropdown list
    await pool.query(
      "UPDATE chat_sessions SET risk_level = $1, burnout_score = $2 WHERE id = $3 AND user_id = $4",
      [riskLevel, parseFloat(burnoutScore), session_id, req.user.id]
    );

    res.status(201).json({ message: 'Result card saved successfully', id: result.rows[0].id });
  } catch (err) {
    console.error("Error saveChatResult:", err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.getSessions = async (req, res) => {
  try {
    let result = await pool.query(
      "SELECT * FROM chat_sessions WHERE user_id = $1 ORDER BY created_at DESC",
      [req.user.id]
    );

    // Jika user belum memiliki sesi obrolan sama sekali, buatkan secara otomatis
    if (result.rows.length === 0) {
      const newSession = await pool.query(
        "INSERT INTO chat_sessions (user_id, title) VALUES ($1, $2) RETURNING *",
        [req.user.id, 'Obrolan Baru #1']
      );
      
      // Kirim salam pembuka default dari AI ke riwayat chat baru ini
      await pool.query(
        "INSERT INTO chat_history (user_id, session_id, sender, text, type) VALUES ($1, $2, $3, $4, $5)",
        [req.user.id, newSession.rows[0].id, 'ai', 'Halo! Saya AI MindEase. Ada yang ingin kamu ceritakan hari ini? Jangan ragu untuk berbagi.', 'text']
      );
      
      return res.json([newSession.rows[0]]);
    }

    res.json(result.rows);
  } catch (err) {
    console.error("Error getSessions:", err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.createSession = async (req, res) => {
  try {
    // Ambil jumlah sesi untuk penomoran
    const countResult = await pool.query(
      "SELECT COUNT(*) FROM chat_sessions WHERE user_id = $1",
      [req.user.id]
    );
    const sessionNum = parseInt(countResult.rows[0].count) + 1;
    const title = `Obrolan Baru #${sessionNum}`;

    const newSession = await pool.query(
      "INSERT INTO chat_sessions (user_id, title) VALUES ($1, $2) RETURNING *",
      [req.user.id, title]
    );

    // Tambahkan salam AI pembuka default
    await pool.query(
      "INSERT INTO chat_history (user_id, session_id, sender, text, type) VALUES ($1, $2, $3, $4, $5)",
      [req.user.id, newSession.rows[0].id, 'ai', 'Halo! Saya AI MindEase. Ada yang ingin kamu ceritakan hari ini? Jangan ragu untuk berbagi.', 'text']
    );

    res.status(201).json(newSession.rows[0]);
  } catch (err) {
    console.error("Error createSession:", err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.deleteSession = async (req, res) => {
  try {
    const { id } = req.params;

    // Hapus sesi (akan memicu cascade ON DELETE pada chat_history secara otomatis)
    await pool.query(
      "DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2",
      [id, req.user.id]
    );

    res.json({ message: 'Sesi obrolan berhasil dihapus.' });
  } catch (err) {
    console.error("Error deleteSession:", err);
    res.status(500).json({ error: 'Database error' });
  }
};

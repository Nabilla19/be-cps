// Native fetch tersedia di Node.js 18+ — tidak perlu install node-fetch
const { pool } = require('../config/db');

let GoogleGenAI, Groq;
try {
  GoogleGenAI = require('@google/genai').GoogleGenAI;
} catch (e) {
  console.warn("Package @google/genai tidak terinstall.");
}
try {
  Groq = require('groq-sdk');
} catch (e) {
  console.warn("Package groq-sdk tidak terinstall.");
}

const FASTAPI_URL = process.env.ML_API_URL || 'http://localhost:8000';

async function callAI(systemPrompt, userMessage) {
  // 1. Coba Gemini jika ada kunci
  if (process.env.GEMINI_API_KEY && GoogleGenAI) {
    console.log("[AI Agent] Menggunakan Google Gemini Model...");
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        { role: 'user', parts: [{ text: `${systemPrompt}\n\nPesan User:\n"${userMessage}"` }] }
      ],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.7
      }
    });
    return response.text;
  }

  // 2. Coba Groq jika ada kunci
  if (process.env.GROQ_API_KEY && Groq) {
    console.log("[AI Agent] Menggunakan Groq Llama Model...");
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 1024,
    });
    return completion.choices[0].message.content;
  }

  throw new Error("No API keys configured");
}

async function callAITitle(userMessage) {
  const prompt = `Buatkan judul percakapan sangat singkat (maksimal 3 kata) yang merangkum maksud dari kalimat ini: "${userMessage}". Balas HANYA dengan judulnya saja, tanpa tanda kutip, tanpa titik.`;

  if (process.env.GEMINI_API_KEY && GoogleGenAI) {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.3 }
    });
    return response.text.trim();
  }

  if (process.env.GROQ_API_KEY && Groq) {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 15
    });
    return completion.choices[0].message.content.trim();
  }

  throw new Error("No API keys configured");
}

function calculateAge(birthDateStr) {
  if (!birthDateStr) return null;
  const birthDate = new Date(birthDateStr);
  if (isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

function mapGender(genderStr) {
  if (!genderStr) return null;
  const g = genderStr.trim().toLowerCase();
  if (g.startsWith('l') || g === 'pria' || g === 'male' || g === 'laki-laki') return 'Male';
  if (g.startsWith('p') || g === 'wanita' || g === 'female' || g === 'perempuan') return 'Female';
  return 'Other';
}


exports.chatAgent = async (req, res) => {
  try {
    const { message, currentState, session_id, mode } = req.body;
    const activeMode = mode || 'chat';

    // Ambil data profil (gender & umur) otomatis untuk disuntikkan demi kenyamanan UX
    let userGender = null;
    let userAge = null;

    if (req.user) {
      try {
        const userRes = await pool.query(
          "SELECT gender, birth_date FROM users WHERE id = $1",
          [req.user.id]
        );
        if (userRes.rows.length > 0) {
          const userObj = userRes.rows[0];
          userGender = mapGender(userObj.gender);
          userAge = calculateAge(userObj.birth_date);
        }
      } catch (dbErr) {
        console.error("Gagal mengambil profil user untuk chatbot:", dbErr.message);
      }
    }

    // Suntikkan gender & age jika belum terisi di currentState
    if (currentState && typeof currentState === 'object') {
      if (userGender && currentState.gender === null) {
        currentState.gender = userGender;
      }
      if (userAge && currentState.age === null) {
        currentState.age = userAge;
      }
    }

    // 1. Perekaman pesan user ke database (hanya jika pengguna sedang login)
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

    // Cek krisis darurat secara lokal demi keamanan!
    const CRISIS_KEYWORDS = [
      "bunuh diri", "ingin mati", "mau mati", "tidak mau hidup", "mau bunuh",
      "mengakhiri hidup", "tidak ada gunanya hidup", "lebih baik mati",
      "pengen mati", "pengin mati", "pengen bunuh diri", "pengin bunuh diri",
      "self harm", "menyakiti diri"
    ];
    const isCrisis = CRISIS_KEYWORDS.some(kw => message.toLowerCase().includes(kw));
    
    if (isCrisis) {
      const crisisResponse = {
        is_crisis: true,
        reply: "Hei, saya mendengarmu. Apa yang kamu rasakan sekarang sangat berat, dan saya khawatir dengan keadaanmu. Kamu tidak harus melewati ini sendirian. Tolong hubungi salah satu bantuan di bawah ini sekarang ya.",
        extractedFeatures: {},
        action: "SHOW_EMERGENCY_CONTACTS",
        hotlines: [
          { name: "Into The Light Indonesia", number: "119", ext: "ext 8", hours: "24 jam" },
          { name: "Yayasan Pulih", number: "02178842580", display: "(021) 788-42580", hours: "Senin-Jumat" },
          { name: "Hotline Kemenkes", number: "1500454", display: "1500-454", hours: "24 jam" }
        ]
      };

      if (req.user && session_id) {
        try {
          await pool.query(
            "INSERT INTO chat_history (user_id, session_id, sender, text, type) VALUES ($1, $2, $3, $4, $5)",
            [req.user.id, session_id, 'ai', crisisResponse.reply, 'text']
          );
        } catch (dbErr) {}
      }

      return res.json(crisisResponse);
    }

    // 2. Coba panggil AI Model jika API Key tersedia
    if ((process.env.GEMINI_API_KEY && GoogleGenAI) || (process.env.GROQ_API_KEY && Groq)) {
      try {
        const CORE_ASSESSMENT_KEYS = [
          'academic_year', 'study_hours_per_day', 'exam_pressure', 'academic_performance',
          'stress_level', 'anxiety_score', 'depression_score', 'sleep_hours',
          'physical_activity', 'social_support', 'screen_time', 'internet_usage',
          'financial_stress', 'family_expectation'
        ];

        const missingFeatures = [];
        if (currentState && typeof currentState === 'object') {
          for (const key of CORE_ASSESSMENT_KEYS) {
            if (currentState[key] === null || currentState[key] === undefined) {
              missingFeatures.push(key);
            }
          }
        }
        const nextQuestionHint = missingFeatures[0] || 'selesai';

        let prompt = "";
        
        if (nextQuestionHint === 'selesai' && activeMode === 'assessment') {
          prompt = `Kamu adalah "MindEase AI", asisten kesehatan mental yang hangat. 
Semua 16 data penting untuk analisis kesehatan mental user (tingkat stres, skor kecemasan, skor depresi, jam tidur, beban kuliah, umur, jenis kelamin, dll) sudah sukses terkumpul lengkap dan utuh!
Beritahu user dengan nada gembira, hangat, dan penuh penghargaan bahwa seluruh data kualitatif mereka telah sukses dianalisis oleh AI. Beritahu mereka untuk mengeklik tombol **"🪄 Lihat Hasil Analisis Lengkap"** di bagian bawah obrolan untuk melihat hasil analisis kesehatan mental mereka secara lengkap! JANGAN mengajukan pertanyaan apa pun lagi.

PENTING: Hanya balas dengan JSON murni dengan struktur:
{"reply": "balasan empati kamu yang memberi tahu bahwa data sudah lengkap", "extractedFeatures": {}}`;
        } else if (activeMode === 'chat') {
          prompt = `Kamu adalah "MindEase AI", sahabat curhat yang sangat empatik, hangat, dan suportif untuk mahasiswa Indonesia.

TUGASMU:
1. Berikan tanggapan yang tulus, penuh empati, dan menenangkan (2-3 kalimat bahasa Indonesia santai).
2. Fokus sepenuhnya pada validasi emosi dan mendengarkan keluh kesah user secara alami.
3. JANGAN pernah menanyakan data teknis, skor, angka, atau variabel apa pun secara paksa. Biarkan percakapan mengalir santai.
4. Di akhir tanggapan, Anda boleh mengajukan satu pertanyaan terbuka yang lembut untuk mendorong mereka bercerita lebih lanjut tentang perasaan mereka (bukan tentang data numerik).
5. Dari pesan user, tetap lakukan ekstraksi secara diam-diam JIKA mereka menceritakan informasi berikut secara natural (jika tidak ada, kosongkan saja):
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

PENTING: Hanya balas dengan JSON murni dengan struktur:
{"reply": "balasan empati kamu", "extractedFeatures": {"nama_fitur": nilai}}`;
        } else {
          prompt = `Kamu adalah "MindEase AI", asisten kesehatan mental yang sangat cerdas, lembut, dan penuh empati. Saat ini kamu sedang membimbing user dalam sesi **Asesmen Kesehatan Mental Terpandu** secara bertahap untuk mengumpulkan data variabel prediksi.

TUGAS UTAMAMU:
1. Identifikasi variabel kosong pada currentState. Target pertanyaan saat ini difokuskan pada: "${nextQuestionHint}".
2. **ATURAN TENTANG PERTANYAAN (WAJIB!):**
   - **Pertanyaan Bertema Besar**: Jika seluruh variabel di dalam grup tema "${nextQuestionHint}" masih kosong/null (berarti kamu baru pertama kali masuk ke tema ini), Anda harus mengajukan **satu pertanyaan kualitatif bertema besar** yang memancing user bercerita.
     * **Grup Tema Pertanyaan**:
       * **Tema Akademik** (Gali: academic_year, study_hours_per_day, exam_pressure, academic_performance): Bertanyalah tentang tingkat perkuliahan, seberapa keras mereka belajar per hari, tekanan ujian, dan bagaimana performa akademik mereka saat ini.
       * **Tema Mental & Tidur** (Gali: stress_level, anxiety_score, depression_score, sleep_hours): Tanyakan mengenai tingkat stres, kecemasan, kelelahan mental, dan berapa jam mereka tidur dalam sehari.
       * **Tema Gaya Hidup & Sosial** (Gali: physical_activity, screen_time, internet_usage, social_support): Tanyakan tentang olahraga, screen time / berselancar internet, dan dukungan dari teman/keluarga.
       * **Tema Tekanan Eksternal** (Gali: financial_stress, family_expectation): Tanyakan mengenai kekhawatiran biaya kuliah/finansial dan tuntutan harapan orang tua.
   - **Pertanyaan Follow-Up Spesifik (ANTI-LOOPING)**: Jika grup tema dari "${nextQuestionHint}" sudah pernah ditanyakan dan terisi sebagian, tetapi variabel "${nextQuestionHint}" ini sendiri masih kosong/null, **JANGAN tanyakan pertanyaan besar bertema itu lagi!** Anda harus menanyakan **satu pertanyaan follow-up yang sangat spesifik, lembut, dan empati khusus untuk menggali "${nextQuestionHint}"** secara natural.
3. Dari jawaban cerita user, Anda harus mendeduksi sebanyak mungkin variabel sekaligus (bisa 3-5 variabel sekaligus dari 1 tanggapan user!).
4. JANGAN menanyakan nilai angka atau rate 1-10 secara langsung! Simpulkan sendiri nilai numeriknya dari cerita kualitatif user:
   - Skala 1-10 (stress_level, anxiety_score, depression_score, exam_pressure, social_support, financial_stress, family_expectation):
     * Sangat ringan/hampir tidak ada -> 1-2
     * Ringan/kadang-kadang -> 3-4
     * Sedang/cukup terasa -> 5-6
     * Berat/sering/mengganggu -> 7-8
     * Sangat berat/ekstrem/tidak tertahankan -> 9-10
   - Skala 0-100 (academic_performance):
     * Kurang/buruk -> 40-59
     * Cukup/sedang -> 60-79
     * Sangat baik/IPK tinggi -> 80-100
5. Masukkan seluruh variabel numerik hasil simpulan Anda tersebut ke dalam objek extractedFeatures.

PENTING: Hanya balas dengan JSON murni dengan struktur:
{"reply": "balasan empati hangat dan pertanyaan kualitatif bertema besar ATAU follow-up spesifik dari kamu", "extractedFeatures": {"nama_fitur": nilai}}`;
        }

        const rawText = await callAI(prompt, message);
        let parsed = { reply: "Aku mendengarmu. Ceritakan lebih banyak ya. 💙", extractedFeatures: {} };
        try {
          parsed = JSON.parse(rawText);
        } catch (jsonErr) {
          const jsonMatch = rawText.match(/\{[\s\S]*\}/);
          if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        }

        const cleanFeatures = {};
        if (parsed.extractedFeatures) {
          for (const [k, v] of Object.entries(parsed.extractedFeatures)) {
            if (v !== null && v !== "") {
              cleanFeatures[k] = v;
            }
          }
        }

        // Suntikkan gender & age jika belum ada di percakapan aktif
        if (userGender && (!currentState || currentState.gender === null)) {
          cleanFeatures.gender = userGender;
        }
        if (userAge && (!currentState || currentState.age === null)) {
          cleanFeatures.age = userAge;
        }

        // Perekaman pesan balasan AI ke database
        if (req.user && session_id && parsed.reply) {
          try {
            await pool.query(
              "INSERT INTO chat_history (user_id, session_id, sender, text, type) VALUES ($1, $2, $3, $4, $5)",
              [req.user.id, session_id, 'ai', parsed.reply, 'text']
            );
          } catch (dbErr) {
            console.error("Gagal merekam chat AI ke DB:", dbErr.message);
          }
        }

        return res.json({
          reply: parsed.reply,
          extractedFeatures: cleanFeatures,
          is_crisis: false,
          action: "CONTINUE_CHAT"
        });

      } catch (aiError) {
        console.warn("⚠️ AI Model Error, beralih ke Smart Local Fallback:", aiError.message);
      }
    }

    // 3. Coba kirim request ke FastAPI (Engine Utama - jika berjalan lokal)
    try {
      const response = await fetch(`${FASTAPI_URL}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
              message: message,
              history: currentState
          })
      });

      if (response.ok) {
        const data = await response.json();
        
        // Suntikkan gender & age jika belum ada di percakapan aktif
        if (!data.extractedFeatures) {
          data.extractedFeatures = {};
        }

        if (userGender && (!currentState || currentState.gender === null)) {
          data.extractedFeatures.gender = userGender;
        }
        if (userAge && (!currentState || currentState.age === null)) {
          data.extractedFeatures.age = userAge;
        }

        if (req.user && session_id && data.reply) {
          try {
            await pool.query(
              "INSERT INTO chat_history (user_id, session_id, sender, text, type) VALUES ($1, $2, $3, $4, $5)",
              [req.user.id, session_id, 'ai', data.reply, 'text']
            );
          } catch (dbErr) {
            console.error("Gagal merekam chat AI ke DB:", dbErr.message);
          }
        }
        return res.json(data);
      }
    } catch (fastApiErr) {
      // Abaikan dan lanjut ke Smart Local Fallback
    }

    // ==========================================
    // SMART LOCAL FALLBACK (Mode Teman Curhat & Asesmen Terpandu)
    // ==========================================
    console.warn("⚠️ FastAPI/Groq Offline. Mengaktifkan Mode Pendukung MindEase (Smart Local Fallback)...");

    const numMatch = message.match(/\b\d+(\.\d+)?\b/);
    const parsedNum = numMatch ? parseFloat(numMatch[0]) : null;
    const extracted = {};

    // Suntikkan gender & age jika belum ada di percakapan aktif
    if (userGender && (!currentState || currentState.gender === null)) {
      extracted.gender = userGender;
    }
    if (userAge && (!currentState || currentState.age === null)) {
      extracted.age = userAge;
    }

    if (activeMode === 'chat') {
      // ----------------------------------------------------
      // Mode Chat / Curhat Santai (Local Fallback)
      // ----------------------------------------------------
      const reply = "Aku di sini untuk mendengarkan keluh kesahmu. Ceritakan saja apa yang sedang membebani pikiranmu secara santai ya. Jika kamu ingin menganalisis tingkat burnout atau stres secara detail, klik tombol **'🪄 Mulai Asesmen Kesehatan Mental'** di bawah obrolan agar aku bisa memandumu secara terarah. 💙";

      // Ekstrak secara pasif jika tidak sengaja menyebutkan gender, umur, atau jam tidur
      const textLower = message.toLowerCase();
      if (textLower.includes('perempuan') || textLower.includes('cewek') || textLower.includes('wanita') || textLower.includes('female')) {
        extracted.gender = 'Female';
      } else if (textLower.includes('laki') || textLower.includes('cowok') || textLower.includes('pria') || textLower.includes('male')) {
        extracted.gender = 'Male';
      }

      if (parsedNum && parsedNum > 10 && parsedNum < 100) {
        extracted.age = parsedNum;
      }

      const sleepMatch = message.match(/\b([1-9]|1[0-2])\s*(jam|hours)\b/i);
      if (sleepMatch) {
        extracted.sleep_hours = parseFloat(sleepMatch[1]);
      }

      // Perekaman pesan balasan AI ke database
      if (req.user && session_id) {
        try {
          await pool.query(
            "INSERT INTO chat_history (user_id, session_id, sender, text, type) VALUES ($1, $2, $3, $4, $5)",
            [req.user.id, session_id, 'ai', reply, 'text']
          );
        } catch (dbErr) {
          console.error("Gagal merekam chat AI ke DB:", dbErr.message);
        }
      }

      return res.json({
        reply,
        extractedFeatures: extracted,
        is_crisis: false,
        action: "CONTINUE_CHAT"
      });
    }

    // ----------------------------------------------------
    // Mode Asesmen Terpandu Tematis (Smart Local Fallback)
    // ----------------------------------------------------
    const THEME_GROUPS = [
      {
        name: 'Akademik',
        keys: ['academic_year', 'study_hours_per_day', 'exam_pressure', 'academic_performance'],
        question: "Mari kita mulai dengan kehidupan perkuliahanmu. 🎓 Di tahun/angkatan ke berapa kamu saat ini? Berapa jam biasanya kamu belajar per hari, seberapa berat tekanan ujian yang kamu rasakan, dan bagaimana performa/nilai akademikmu sejauh ini? Ceritakan secara kualitatif, aku akan menyimpulkannya sendiri. 💙"
      },
      {
        name: 'Mental & Tidur',
        keys: ['stress_level', 'anxiety_score', 'depression_score', 'sleep_hours'],
        question: "Selanjutnya, bagaimana dengan kondisi emosionalmu belakangan ini? 💙 Dari skala rasa stres, kecemasan, atau kesedihan yang kamu rasakan, serta berapa jam rata-rata kamu tidur dalam sehari? Tumpahkan saja perasaanmu ya."
      },
      {
        name: 'Gaya Hidup & Sosial',
        keys: ['physical_activity', 'social_support', 'screen_time', 'internet_usage'],
        question: "Mari kita lihat gaya hidupmu sehari-hari. 🌟 Berapa jam biasanya kamu berolahraga dalam seminggu? Lalu, berapa jam screen time atau berselancar internet dalam sehari, dan seberapa besar dukungan sosial yang kamu rasakan dari teman atau keluarga? Ceritakan singkat saja ya."
      },
      {
        name: 'Tekanan Eksternal',
        keys: ['financial_stress', 'family_expectation'],
        question: "Terakhir, apakah ada tekanan dari luar yang membebanimu saat ini? 🏡 Seperti kekhawatiran finansial (biaya kuliah) atau ekspektasi yang tinggi dari orang tua/keluarga?"
      }
    ];

    const individualQuestions = {
      academic_year: "Boleh tahu saat ini kamu sedang menempuh perkuliahan di tahun/angkatan ke berapa? (1 - 4) 🎓",
      study_hours_per_day: "Boleh ceritakan lebih lanjut, berapa jam biasanya kamu habiskan untuk belajar dalam sehari? 📚",
      exam_pressure: "Dari skala 1 sampai 10, seberapa berat tekanan ujian yang kamu rasakan akhir-akhir ini? 📝",
      academic_performance: "Lalu, berapa perkiraan rata-rata nilai akademik (IPK/performa) kamu dalam skala 100? 🎯",
      stress_level: "Boleh tahu dari skala 1 sampai 10, berapa tingkat stres yang kamu rasakan belakangan ini? ⚡",
      anxiety_score: "Dari skala 1 sampai 10, seberapa sering kamu merasakan kecemasan berlebih? 😟",
      depression_score: "Dari skala 1 sampai 10, seberapa sering kamu merasa sedih atau lelah emosional? 😢",
      sleep_hours: "Berapa jam rata-rata kamu tidur dalam sehari akhir-akhir ini? 😴",
      physical_activity: "Berapa jam biasanya kamu berolahraga atau melakukan aktivitas fisik dalam seminggu? 🏃‍♂️",
      social_support: "Dari skala 1 sampai 10, seberapa besar dukungan sosial yang kamu rasakan dari teman atau keluarga? 👥",
      screen_time: "Berapa jam rata-rata screen time (waktu di depan HP/laptop) kamu per hari? 📱",
      internet_usage: "Berapa jam waktu yang kamu habiskan untuk internetan dalam sehari? 🌐",
      financial_stress: "Dari skala 1 sampai 10, seberapa besar tekanan finansial yang kamu rasakan saat ini? 💸",
      family_expectation: "Dari skala 1 sampai 10, seberapa tinggi ekspektasi atau tuntutan keluarga yang membebanimu? 🏡"
    };

    // Cari grup pertama yang masih belum lengkap berdasarkan currentState
    let currentIncompleteGroup = null;
    for (const group of THEME_GROUPS) {
      const isGroupIncomplete = group.keys.some(k => !currentState || currentState[k] === null || currentState[k] === undefined);
      if (isGroupIncomplete) {
        currentIncompleteGroup = group;
        break;
      }
    }

    const isStartTrigger = message.toLowerCase().includes("mulai sesi asesmen") || message.toLowerCase().includes("memulai sesi");

    if (currentIncompleteGroup && !isStartTrigger) {
      // Jalankan parser ekstraksi mandiri berbasis pola teks untuk seluruh variabel di grup tema aktif
      const textLower = message.toLowerCase();

      // 1. Ekstrak academic_year jika kosong
      if (!currentState || currentState.academic_year === null || currentState.academic_year === undefined) {
        const yearMatch = message.match(/\b([1-4])\b/);
        if (yearMatch) {
          extracted.academic_year = parseInt(yearMatch[1]);
        } else if (textLower.includes("pertama") || textLower.includes("maba") || textLower.includes("satu")) {
          extracted.academic_year = 1;
        } else if (textLower.includes("kedua") || textLower.includes("dua")) {
          extracted.academic_year = 2;
        } else if (textLower.includes("ketiga") || textLower.includes("tiga")) {
          extracted.academic_year = 3;
        } else if (textLower.includes("keempat") || textLower.includes("empat") || textLower.includes("akhir")) {
          extracted.academic_year = 4;
        }
      }

      // 2. Ekstrak study_hours_per_day
      if (!currentState || currentState.study_hours_per_day === null || currentState.study_hours_per_day === undefined) {
        const hoursMatch = message.match(/\b([1-9]|1[0-2])\s*(jam|hours)\b/i);
        if (hoursMatch) {
          extracted.study_hours_per_day = parseFloat(hoursMatch[1]);
        } else if (parsedNum && parsedNum >= 1 && parsedNum <= 12 && parsedNum !== extracted.academic_year && (!currentState || parsedNum !== currentState.academic_year)) {
          extracted.study_hours_per_day = parsedNum;
        }
      }

      // 3. Ekstrak exam_pressure
      if (!currentState || currentState.exam_pressure === null || currentState.exam_pressure === undefined) {
        const scoreMatch = message.match(/\b([1-9]|10)\b/);
        if (textLower.includes("berat") || textLower.includes("stres") || textLower.includes("parah") || textLower.includes("tinggi") || textLower.includes("besar") || textLower.includes("pusing") || textLower.includes("capek")) {
          extracted.exam_pressure = 8.0;
        } else if (textLower.includes("santai") || textLower.includes("rendah") || textLower.includes("aman") || textLower.includes("lancar")) {
          extracted.exam_pressure = 3.0;
        } else if (scoreMatch) {
          extracted.exam_pressure = parseFloat(scoreMatch[1]);
        }
      }

      // 4. Ekstrak academic_performance
      if (!currentState || currentState.academic_performance === null || currentState.academic_performance === undefined) {
        const perfMatch = message.match(/\b([5-9][0-9]|100)\b/);
        if (perfMatch) {
          extracted.academic_performance = parseFloat(perfMatch[1]);
        } else if (textLower.includes("bagus") || textLower.includes("tinggi") || textLower.includes("memuaskan") || textLower.includes("aman")) {
          extracted.academic_performance = 85.0;
        } else if (textLower.includes("buruk") || textLower.includes("turun") || textLower.includes("jelek") || textLower.includes("anjlok")) {
          extracted.academic_performance = 55.0;
        }
      }

      // 5. Ekstrak stress_level
      if (!currentState || currentState.stress_level === null || currentState.stress_level === undefined) {
        if (textLower.includes("stres berat") || textLower.includes("stres banget") || textLower.includes("sangat stres") || textLower.includes("parah")) {
          extracted.stress_level = 8.0;
        } else if (textLower.includes("tidak stres") || textLower.includes("aman") || textLower.includes("santai") || textLower.includes("tenang")) {
          extracted.stress_level = 2.0;
        } else if (parsedNum && parsedNum >= 1 && parsedNum <= 10) {
          extracted.stress_level = parsedNum;
        }
      }

      // 6. Ekstrak anxiety_score
      if (!currentState || currentState.anxiety_score === null || currentState.anxiety_score === undefined) {
        if (textLower.includes("cemas banget") || textLower.includes("panik") || textLower.includes("anxiety") || textLower.includes("takut banget")) {
          extracted.anxiety_score = 8.0;
        } else if (textLower.includes("tenang") || textLower.includes("tidak cemas")) {
          extracted.anxiety_score = 2.0;
        } else if (parsedNum && parsedNum >= 1 && parsedNum <= 10) {
          extracted.anxiety_score = parsedNum;
        }
      }

      // 7. Ekstrak depression_score
      if (!currentState || currentState.depression_score === null || currentState.depression_score === undefined) {
        if (textLower.includes("depresi") || textLower.includes("sedih banget") || textLower.includes("putus asa") || textLower.includes("menangis")) {
          extracted.depression_score = 8.0;
        } else if (textLower.includes("bahagia") || textLower.includes("senang") || textLower.includes("ceria")) {
          extracted.depression_score = 2.0;
        } else if (parsedNum && parsedNum >= 1 && parsedNum <= 10) {
          extracted.depression_score = parsedNum;
        }
      }

      // 8. Ekstrak sleep_hours
      if (!currentState || currentState.sleep_hours === null || currentState.sleep_hours === undefined) {
        const sleepMatch = message.match(/\b([1-9]|1[0-2])\s*(jam|hours)\b/i);
        if (sleepMatch) {
          extracted.sleep_hours = parseFloat(sleepMatch[1]);
        } else if (parsedNum && parsedNum >= 1 && parsedNum <= 12) {
          extracted.sleep_hours = parsedNum;
        }
      }

      // 9. Ekstrak physical_activity
      if (!currentState || currentState.physical_activity === null || currentState.physical_activity === undefined) {
        if (textLower.includes("jarang") || textLower.includes("tidak pernah") || textLower.includes("gapernah") || textLower.includes("mager")) {
          extracted.physical_activity = 0.5;
        } else if (textLower.includes("sering") || textLower.includes("tiap hari") || textLower.includes("rutin")) {
          extracted.physical_activity = 5.0;
        }
      }

      // 10. Ekstrak screen_time & internet_usage
      if (!currentState || currentState.screen_time === null || currentState.screen_time === undefined) {
        const scrMatch = message.match(/\b([1-9]|1[0-9])\s*(jam|hours)\b/i);
        if (scrMatch) {
          extracted.screen_time = parseFloat(scrMatch[1]);
          extracted.internet_usage = parseFloat(scrMatch[1]);
        } else if (textLower.includes("sering") || textLower.includes("lama") || textLower.includes("seharian")) {
          extracted.screen_time = 9.0;
          extracted.internet_usage = 9.0;
        }
      }

      // 11. Ekstrak social_support
      if (!currentState || currentState.social_support === null || currentState.social_support === undefined) {
        if (textLower.includes("banyak teman") || textLower.includes("didukung") || textLower.includes("selalu ada")) {
          extracted.social_support = 8.0;
        } else if (textLower.includes("kesepian") || textLower.includes("sendiri") || textLower.includes("gapunya teman")) {
          extracted.social_support = 3.0;
        }
      }

      // 12. Ekstrak financial_stress
      if (!currentState || currentState.financial_stress === null || currentState.financial_stress === undefined) {
        if (textLower.includes("uang") || textLower.includes("biaya") || textLower.includes("finansial") || textLower.includes("mahal") || textLower.includes("miskin") || textLower.includes("susah bayar")) {
          extracted.financial_stress = 8.0;
        } else if (textLower.includes("aman") || textLower.includes("cukup") || textLower.includes("tidak masalah")) {
          extracted.financial_stress = 3.0;
        }
      }

      // 13. Ekstrak family_expectation
      if (!currentState || currentState.family_expectation === null || currentState.family_expectation === undefined) {
        if (textLower.includes("tuntutan") || textLower.includes("ekspektasi") || textLower.includes("orang tua") || textLower.includes("harapan keluarga")) {
          extracted.family_expectation = 8.0;
        } else if (textLower.includes("santai") || textLower.includes("bebas") || textLower.includes("tidak menuntut")) {
          extracted.family_expectation = 3.0;
        }
      }
    }

    // Gabungkan dengan currentState untuk mencari variabel tidak lengkap berikutnya
    const tempState = { ...(currentState || {}), ...extracted };

    // Cari variabel tidak lengkap berikutnya
    let nextFeature = null;
    const CORE_ASSESSMENT_KEYS = [
      'academic_year', 'study_hours_per_day', 'exam_pressure', 'academic_performance',
      'stress_level', 'anxiety_score', 'depression_score', 'sleep_hours',
      'physical_activity', 'social_support', 'screen_time', 'internet_usage',
      'financial_stress', 'family_expectation'
    ];
    for (const key of CORE_ASSESSMENT_KEYS) {
      if (tempState[key] === null || tempState[key] === undefined) {
        nextFeature = key;
        break;
      }
    }

    let reply = "";
    if (nextFeature) {
      // Temukan grup tema dari nextFeature
      let nextGroup = null;
      for (const group of THEME_GROUPS) {
        if (group.keys.includes(nextFeature)) {
          nextGroup = group;
          break;
        }
      }

      // Cek apakah seluruh variabel di grup tema dari nextFeature ini masih kosong/null di tempState
      const isWholeGroupEmpty = nextGroup.keys.every(k => tempState[k] === null || tempState[k] === undefined);

      if (isWholeGroupEmpty) {
        // Jika seluruh variabel di tema tersebut masih kosong, ajukan pertanyaan kualitatif bertema besar!
        reply = nextGroup.question;
      } else {
        // Jika sudah terisi sebagian, ajukan pertanyaan follow-up yang sangat spesifik untuk variabel nextFeature!
        reply = individualQuestions[nextFeature] || `Boleh ceritakan seputar ${nextFeature} kamu?`;
      }
    } else {
      reply = "Semua informasimu telah lengkap terkumpul! Yuk, klik tombol **'🪄 Lihat Hasil Analisis Lengkap'** di bagian bawah obrolan untuk melihat hasil analisis kesehatan mentalmu. 🪄";
    }

    // Perekaman pesan AI ke database
    if (req.user && session_id && reply) {
      try {
        await pool.query(
          "INSERT INTO chat_history (user_id, session_id, sender, text, type) VALUES ($1, $2, $3, $4, $5)",
          [req.user.id, session_id, 'ai', reply, 'text']
        );
      } catch (dbErr) {
        console.error("Gagal merekam chat AI ke DB:", dbErr.message);
      }
    }

    return res.json({
      reply,
      extractedFeatures: extracted,
      is_crisis: false,
      action: "CONTINUE_CHAT"
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
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
      "SELECT COUNT(*) AS count FROM chat_sessions WHERE user_id = $1",
      [req.user.id]
    );
    const row = countResult.rows[0];
    const sessionNum = (parseInt(row.count || row['count(*)'] || row['COUNT(*)']) || 0) + 1;
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

exports.updateSession = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, is_pinned } = req.body;

    let query = "UPDATE chat_sessions SET ";
    const values = [];
    let count = 1;

    if (title !== undefined) {
      query += `title = $${count} `;
      values.push(title);
      count++;
    }

    if (is_pinned !== undefined) {
      if (count > 1) query += ", ";
      query += `is_pinned = $${count} `;
      values.push(is_pinned);
      count++;
    }

    if (values.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    query += `WHERE id = $${count} AND user_id = $${count + 1} RETURNING *`;
    values.push(id, req.user.id);

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error updateSession:", err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.generateSessionTitle = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Panggil FastAPI untuk generate judul
    const response = await fetch(`${FASTAPI_URL}/generate-title`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });

    if (!response.ok) {
      throw new Error(`FastAPI error: ${response.status}`);
    }

    const data = await response.json();
    const newTitle = data.title || "Obrolan Baru";

    // Update title di database
    const result = await pool.query(
      "UPDATE chat_sessions SET title = $1 WHERE id = $2 AND user_id = $3 RETURNING *",
      [newTitle, id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error generateSessionTitle:", err.message);
    res.status(500).json({ error: 'Failed to generate title' });
  }
};

exports.predictHealth = async (req, res) => {
  const { features } = req.body;
  try {
    // 1. Coba hubungi FastAPI di port 8000 jika menyala
    const response = await fetch(`${FASTAPI_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ features })
    });
    if (response.ok) {
      const data = await response.json();
      return res.json(data);
    }
  } catch (e) {
    console.warn("⚠️ FastAPI Offline untuk prediksi, menggunakan AI/Heuristik lokal...");
  }

  // 2. Jika offline, hitung secara lokal
  const stress = parseFloat(features.stress_level || 5);
  const anxiety = parseFloat(features.anxiety_score || 5);
  const depression = parseFloat(features.depression_score || 5);
  const averageScore = (stress + anxiety + depression) / 3;
  
  let riskLevel = 'Low';
  if (averageScore >= 7) {
    riskLevel = 'High';
  } else if (averageScore >= 4) {
    riskLevel = 'Medium';
  }
  const burnoutScore = Math.min(10, Math.max(0, parseFloat((averageScore * 1.1).toFixed(1))));

  // 3. Panggil AI untuk memberikan rekomendasi hangat jika ada key
  let recommendation = "Keadaan emosionalmu tampak cukup stabil. Tetap pertahankan pola hidup seimbang dan luangkan waktu untuk relaksasi ya.";
  try {
    if ((process.env.GEMINI_API_KEY && GoogleGenAI) || (process.env.GROQ_API_KEY && Groq)) {
      const levelMap = { 'High': 'tinggi', 'Medium': 'sedang', 'Low': 'rendah' };
      const levelIndo = levelMap[riskLevel] || 'stabil';
      const aiPrompt = `Kamu adalah asisten kesehatan mental yang hangat. Analisis hasil mahasiswa: tingkat risiko mental ${levelIndo}, skor burnout ${burnoutScore} dari 10. Berikan rekomendasi singkat yang memotivasi dan penuh empati dalam 2-3 kalimat santai bahasa Indonesia. JANGAN sebut angka atau skor apa pun.`;
      
      const aiText = await callAI(aiPrompt, "Berikan saya rekomendasi.");
      if (aiText) {
        try {
          const parsed = JSON.parse(aiText);
          recommendation = parsed.reply || aiText;
        } catch (e) {
          recommendation = aiText;
        }
      }
    }
  } catch (err) {
    console.error("Gagal mendapatkan rekomendasi AI:", err);
  }

  res.json({
    risk_level: riskLevel,
    burnout_score: burnoutScore,
    genai_recommendation: recommendation
  });
};



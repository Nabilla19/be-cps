const nodemailer = require('nodemailer');
const { pool } = require('../config/db');
const dns = require('dns');
require('dotenv').config();

// Resolusi IP secara dinamis di level modul demi memutus rute IPv6 IndiHome yang bermasalah.
let gmailIpv4 = '74.125.200.108'; // IP Default sebagai fallback cadangan

dns.resolve4('smtp.gmail.com', (err, addresses) => {
  if (!err && addresses && addresses.length > 0) {
    gmailIpv4 = addresses[0];
    console.log(`📡 [SMTP DNS] Sukses meresolusi smtp.gmail.com ke IPv4: ${gmailIpv4}`);
  } else {
    console.warn(`⚠️  [SMTP DNS] Gagal meresolusi smtp.gmail.com, menggunakan fallback: ${gmailIpv4}`);
  }
});

// Create the nodemailer transporter
const getTransporter = () => {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  // Check if SMTP is using default placeholder values
  const isPlaceholder = !user || user === 'your_email@gmail.com' || !pass || pass === 'your_app_password';

  if (isPlaceholder) {
    console.log('⚠️  SMTP belum dikonfigurasi dengan akun asli. Menggunakan mode simulasi (Log Console).');
    return null;
  }

  // Jika menggunakan Gmail di LOCAL (bukan Render), sambungkan langsung ke IPv4 fisik dengan TLS servername bypass
  const isRender = process.env.RENDER === 'true' || process.env.NODE_ENV === 'production';
  if (host && host.includes('gmail.com') && !isRender) {
    return nodemailer.createTransport({
      host: gmailIpv4, // Menggunakan IP IPv4 langsung demi menghindari bypass DNS IPv6 IndiHome
      port: 465,
      secure: true, // Port 465 SSL yang terbukti sempat bekerja
      auth: {
        user,
        pass
      },
      connectionTimeout: 15000, // Memberikan kelonggaran batas waktu koneksi pada jaringan lambat (15 detik)
      greetingTimeout: 15000,
      socketTimeout: 20000,
      tls: {
        rejectUnauthorized: false, // Mengabaikan validasi CA bundle lokal yang rusak di Windows Anda
        servername: 'smtp.gmail.com' // Menghindari kesalahan sertifikat hostname mismatch karena memakai IP
      }
    });
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true untuk port 465, false untuk port lainnya seperti 587
    auth: {
      user,
      pass
    },
    connectionTimeout: 15000, // Memberikan kelonggaran batas waktu koneksi pada jaringan lambat (15 detik)
    greetingTimeout: 15000,
    socketTimeout: 20000,
    tls: {
      rejectUnauthorized: false // Mengabaikan validasi CA bundle lokal yang rusak di Windows Anda
    },
    // Paksa resolusi DNS untuk hanya mengembalikan alamat IPv4, menghindari ENETUNREACH pada IPv6
    lookup: (hostname, options, callback) => {
      dns.lookup(hostname, { family: 4 }, (err, address, family) => {
        callback(err, address, family);
      });
    }
  });
};

/**
 * Mendapatkan daftar seluruh user beserta status check-in harian mereka
 */
const getUsersWithoutDailyCheckin = async (todayDate) => {
  try {
    const query = `
      SELECT u.id, u.username, u.email,
             EXISTS(SELECT 1 FROM moods m WHERE m.user_id = u.id AND m.date = $1) as has_checked_in
      FROM users u
      WHERE u.email IS NOT NULL 
        AND u.email != ''
    `;
    const result = await pool.query(query, [todayDate]);
    return result.rows;
  } catch (err) {
    console.error('Error querying users with checkin status:', err);
    return [];
  }
};

/**
 * Template HTML email reminder premium bertema MindEase
 */
const getReminderEmailTemplate = (username, hasCheckedIn) => {
  const checkinFlag = !!hasCheckedIn;
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Refleksi Harian MindEase</title>
      <style>
        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background-color: #f3fbfb;
          margin: 0;
          padding: 0;
          -webkit-font-smoothing: antialiased;
        }
        .container {
          max-width: 600px;
          margin: 40px auto;
          background-color: #ffffff;
          border-radius: 24px;
          overflow: hidden;
          box-shadow: 0 10px 30px rgba(22, 160, 160, 0.05);
          border: 1px solid rgba(22, 160, 160, 0.1);
        }
        .header {
          background: linear-gradient(135deg, #16a0a0, #0e6363);
          padding: 40px 20px;
          text-align: center;
          color: #ffffff;
        }
        .header h1 {
          margin: 10px 0 0 0;
          font-size: 26px;
          font-weight: 800;
          letter-spacing: -0.5px;
        }
        .header p {
          margin: 5px 0 0 0;
          font-size: 14px;
          opacity: 0.9;
        }
        .logo-icon {
          display: inline-block;
          background-color: rgba(255, 255, 255, 0.2);
          padding: 12px;
          border-radius: 16px;
          margin-bottom: 10px;
        }
        .content {
          padding: 40px 35px;
          color: #2d3748;
          line-height: 1.7;
        }
        .greeting {
          font-size: 20px;
          font-weight: 700;
          margin-bottom: 15px;
          color: #0e6363;
        }
        .message {
          font-size: 16px;
          margin-bottom: 30px;
          color: #4a5568;
        }
        .status-box {
          background-color: ${checkinFlag ? '#e6fffa' : '#ffebeb'};
          border: 2px dashed ${checkinFlag ? '#16a0a0' : '#e53e3e'};
          border-radius: 16px;
          padding: 20px;
          text-align: center;
          margin-bottom: 25px;
        }
        .status-title {
          margin: 0 0 8px 0;
          font-size: 18px;
          font-weight: 800;
          color: ${checkinFlag ? '#0e6363' : '#9b2c2c'};
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .status-desc {
          margin: 0;
          font-size: 15px;
          color: ${checkinFlag ? '#16a0a0' : '#c53030'};
          line-height: 1.6;
        }
        .card {
          background-color: #f7fafc;
          border-left: 4px solid #16a0a0;
          padding: 20px;
          border-radius: 12px;
          margin-bottom: 30px;
        }
        .quote {
          font-style: italic;
          color: #4a5568;
          font-size: 15px;
          line-height: 1.6;
        }
        .btn-wrapper {
          text-align: center;
          margin: 35px 0 15px 0;
        }
        .btn {
          display: inline-block;
          background: linear-gradient(135deg, #16a0a0, #0e6363);
          color: #ffffff !important;
          text-decoration: none;
          padding: 14px 32px;
          border-radius: 16px;
          font-weight: 700;
          font-size: 16px;
          box-shadow: 0 4px 15px rgba(22, 160, 160, 0.3);
          transition: transform 0.2s ease;
        }
        .footer {
          background-color: #f7fafc;
          padding: 25px;
          text-align: center;
          font-size: 13px;
          color: #a0aec0;
          border-top: 1px solid #edf2f7;
        }
        .footer a {
          color: #16a0a0;
          text-decoration: none;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
            </svg>
          </div>
          <h1>MindEase</h1>
          <p>Sahabat Kesehatan Mental & Emosionalmu</p>
        </div>
        <div class="content">
          <div class="greeting">Halo, ${username}! 🌟</div>
          
          <div class="status-box">
            <div class="status-title">sudah bl m km checkin</div>
            <div class="status-desc">
              ${checkinFlag 
                ? '<strong>Status: Sudah Check-in!</strong> 🎉<br>Luar biasa! Terima kasih telah melakukan check-in suasana hati hari ini. Tetap pantau kesehatan mentalmu secara konsisten ya.' 
                : '<strong>Status: Belum Check-in!</strong> ⚠️<br>Kamu belum melakukan check-in suasana hati hari ini. Yuk, luangkan waktu sejenak untuk mencatat perasaanmu agar pola emosimu tetap terpantau dengan baik.'}
            </div>
          </div>

          <p class="message">
            Bagaimana kabarmu hari ini? Kami ingin mengingatkanmu untuk meluangkan waktu sejenak demi dirimu sendiri. Mengisi catatan suasana hati (*daily mood check-in*) dapat membantumu memahami pola emosi dan menjaga kesehatan mentalmu dengan lebih baik.
          </p>
          <div class="card">
            <p class="quote" style="margin: 0;">
              "Merawat diri sendiri bukanlah kemewahan, melainkan kebutuhan. Menyadari perasaanmu hari ini adalah langkah awal yang sangat berharga."
            </p>
          </div>
          <p class="message" style="margin-bottom: 10px;">
            ${checkinFlag 
              ? 'Kamu dapat memantau kembali catatan emosimu hari ini melalui dashboard MindEase:'
              : 'Hanya butuh waktu kurang dari 1 menit untuk melakukan check-in hari ini! Yuk, catat perasaanmu sekarang:'}
          </p>
          <div class="btn-wrapper">
            <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}" class="btn">
              ${checkinFlag ? 'Lihat Dashboard MindEase' : 'Check-in Mood Sekarang'}
            </a>
          </div>
        </div>
        <div class="footer">
          <p style="margin: 0 0 8px 0;">Email ini dikirim secara otomatis oleh sistem pengingat harian MindEase.</p>
          <p style="margin: 0;">&copy; 2026 MindEase. Dibuat dengan 💚 untuk kesehatan mental Anda.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

/**
 * Mengirimkan email pengingat harian ke semua user (baik sudah atau belum check-in)
 */
const sendDailyMoodReminders = async () => {
  const todayDate = new Date().toLocaleDateString('en-CA'); // format: YYYY-MM-DD
  console.log(`[EmailService] Memulai proses pengiriman email pengingat untuk tanggal: ${todayDate}`);

  try {
    const users = await getUsersWithoutDailyCheckin(todayDate);
    if (users.length === 0) {
      console.log('[EmailService] Tidak ada pengguna terdaftar dengan email valid.');
      return { success: true, count: 0, message: 'Tidak ada pengguna terdaftar dengan email valid.' };
    }

    console.log(`[EmailService] Menemukan ${users.length} pengguna terdaftar untuk dikirimi pengingat harian.`);
    const transporter = getTransporter();
    let sentCount = 0;
    let simulatedCount = 0;

    for (const user of users) {
      const isCheckedIn = !!user.has_checked_in;
      const statusText = isCheckedIn ? 'Sudah Check-in' : 'Belum Check-in';
      
      const mailOptions = {
        from: process.env.SMTP_FROM || '"MindEase Reminder" <noreply@mindease.com>',
        to: user.email,
        subject: `MindEase: sudah bl m km checkin? 🌟 [${statusText}]`,
        html: getReminderEmailTemplate(user.username, isCheckedIn)
      };

      if (transporter) {
        try {
          await transporter.sendMail(mailOptions);
          console.log(`[EmailService] 📧 Email pengingat terkirim ke: ${user.username} (${user.email}) - Status: ${statusText}`);
          sentCount++;
          continue; // Lanjut ke user berikutnya tanpa menjalankan blok simulasi di bawah
        } catch (err) {
          console.error(`[EmailService] Gagal mengirim email asli ke ${user.email} (${err.message}). Beralih ke simulasi...`);
        }
      }

      // Simulasi Log ke Console jika SMTP kosong ATAU jika pengiriman asli gagal/terblokir
      console.log(`\n==================================================`);
      console.log(`📧 [SIMULASI EMAIL REMINDER]`);
      console.log(`   Penerima: ${user.username} (${user.email})`);
      console.log(`   Subjek  : ${mailOptions.subject}`);
      console.log(`   Status  : Berhasil disimulasikan karena SMTP kosong atau gagal terkirim. (${statusText})`);
      console.log(`==================================================\n`);
      simulatedCount++;
    }

    return {
      success: true,
      count: sentCount > 0 ? sentCount : simulatedCount,
      type: transporter ? 'real' : 'simulation',
      message: transporter 
        ? `Berhasil mengirim ${sentCount} email pengingat asli.` 
        : `Berhasil mensimulasikan ${simulatedCount} email pengingat ke log server.`
    };
  } catch (err) {
    console.error('[EmailService] Terjadi kesalahan kritis saat mengirim pengingat:', err);
    return { success: false, error: err.message };
  }
};

const getResetPasswordEmailTemplate = (username, token) => {
  const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${token}`;
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Reset Password MindEase</title>
      <style>
        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background-color: #f3fbfb;
          margin: 0;
          padding: 0;
          -webkit-font-smoothing: antialiased;
        }
        .container {
          max-width: 600px;
          margin: 40px auto;
          background-color: #ffffff;
          border-radius: 24px;
          overflow: hidden;
          box-shadow: 0 10px 30px rgba(22, 160, 160, 0.05);
          border: 1px solid rgba(22, 160, 160, 0.1);
        }
        .header {
          background: linear-gradient(135deg, #16a0a0, #0e6363);
          padding: 40px 20px;
          text-align: center;
          color: #ffffff;
        }
        .header h1 {
          margin: 10px 0 0 0;
          font-size: 26px;
          font-weight: 800;
          letter-spacing: -0.5px;
        }
        .header p {
          margin: 5px 0 0 0;
          font-size: 14px;
          opacity: 0.9;
        }
        .logo-icon {
          display: inline-block;
          background-color: rgba(255, 255, 255, 0.2);
          padding: 12px;
          border-radius: 16px;
          margin-bottom: 10px;
        }
        .content {
          padding: 40px 35px;
          color: #2d3748;
          line-height: 1.7;
        }
        .greeting {
          font-size: 20px;
          font-weight: 700;
          margin-bottom: 15px;
          color: #0e6363;
        }
        .message {
          font-size: 16px;
          margin-bottom: 30px;
          color: #4a5568;
        }
        .card {
          background-color: #f7fafc;
          border-left: 4px solid #f43f5e;
          padding: 20px;
          border-radius: 12px;
          margin-bottom: 30px;
        }
        .warning-text {
          color: #4a5568;
          font-size: 14px;
          line-height: 1.6;
          margin: 0;
        }
        .btn-wrapper {
          text-align: center;
          margin: 35px 0 15px 0;
        }
        .btn {
          display: inline-block;
          background: linear-gradient(135deg, #16a0a0, #0e6363);
          color: #ffffff !important;
          text-decoration: none;
          padding: 14px 32px;
          border-radius: 16px;
          font-weight: 700;
          font-size: 16px;
          box-shadow: 0 4px 15px rgba(22, 160, 160, 0.3);
          transition: transform 0.2s ease;
        }
        .footer {
          background-color: #f7fafc;
          padding: 25px;
          text-align: center;
          font-size: 13px;
          color: #a0aec0;
          border-top: 1px solid #edf2f7;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
            </svg>
          </div>
          <h1>MindEase</h1>
          <p>Kesehatan Mental & Emosional Aman</p>
        </div>
        <div class="content">
          <div class="greeting">Halo, ${username}! 🔑</div>
          <p class="message">
            Kami menerima permintaan untuk menyetel ulang kata sandi (reset password) akun MindEase Anda. Silakan klik tombol di bawah ini untuk menyetel kata sandi yang baru:
          </p>
          <div class="btn-wrapper">
            <a href="${resetLink}" class="btn">Reset Password Saya</a>
          </div>
          <div class="card">
            <p class="warning-text">
              <strong>Penting:</strong> Tautan ini hanya berlaku selama <strong>1 jam</strong> dari sekarang. Jika Anda tidak merasa melakukan permintaan ini, silakan abaikan email ini dan kata sandi Anda akan tetap aman.
            </p>
          </div>
        </div>
        <div class="footer">
          <p style="margin: 0 0 8px 0;">Email ini dikirim secara otomatis oleh sistem keamanan MindEase.</p>
          <p style="margin: 0;">&copy; 2026 MindEase. Dibuat dengan 💚 untuk kesehatan mental Anda.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

const sendResetPasswordEmail = async (email, username, token) => {
  const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${token}`;
  console.log(`[EmailService] Memulai pengiriman link reset password ke: ${email}`);

  const transporter = getTransporter();
  const mailOptions = {
    from: process.env.SMTP_FROM || '"MindEase" <security@mindease.com>',
    to: email,
    subject: 'MindEase: Permintaan Reset Password 🔑',
    html: getResetPasswordEmailTemplate(username, token)
  };

  if (transporter) {
    try {
      await transporter.sendMail(mailOptions);
      console.log(`[EmailService] 📧 Email reset password berhasil terkirim ke: ${email}`);
      return { success: true, type: 'real' };
    } catch (err) {
      console.error(`[EmailService] Gagal mengirim email asli ke ${email} (${err.message}). Beralih ke simulasi...`);
    }
  }

  // Fallback log console jika gagal/SMTP tidak diatur
  console.log(`\n==================================================`);
  console.log(`🔑 [SIMULASI EMAIL RESET PASSWORD]`);
  console.log(`   Penerima : ${username} (${email})`);
  console.log(`   Subjek   : ${mailOptions.subject}`);
  console.log(`   Link     : ${resetLink}`);
  console.log(`   Status   : Tautan dicetak karena pengiriman email asli gagal/belum diatur.`);
  console.log(`==================================================\n`);
  return { success: true, type: 'simulation', resetLink };
};

const getWelcomeEmailTemplate = (username) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Selamat Datang di MindEase</title>
      <style>
        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background-color: #f3fbfb;
          margin: 0;
          padding: 0;
          -webkit-font-smoothing: antialiased;
        }
        .container {
          max-width: 600px;
          margin: 40px auto;
          background-color: #ffffff;
          border-radius: 24px;
          overflow: hidden;
          box-shadow: 0 10px 30px rgba(22, 160, 160, 0.05);
          border: 1px solid rgba(22, 160, 160, 0.1);
        }
        .header {
          background: linear-gradient(135deg, #16a0a0, #0e6363);
          padding: 40px 20px;
          text-align: center;
          color: #ffffff;
        }
        .header h1 {
          margin: 10px 0 0 0;
          font-size: 26px;
          font-weight: 800;
          letter-spacing: -0.5px;
        }
        .header p {
          margin: 5px 0 0 0;
          font-size: 14px;
          opacity: 0.9;
        }
        .logo-icon {
          display: inline-block;
          background-color: rgba(255, 255, 255, 0.2);
          padding: 12px;
          border-radius: 16px;
          margin-bottom: 10px;
        }
        .content {
          padding: 40px 35px;
          color: #2d3748;
          line-height: 1.7;
        }
        .greeting {
          font-size: 20px;
          font-weight: 700;
          margin-bottom: 15px;
          color: #0e6363;
        }
        .message {
          font-size: 16px;
          margin-bottom: 20px;
          color: #4a5568;
        }
        .feature-list {
          margin: 25px 0;
          padding-left: 0;
          list-style: none;
        }
        .feature-item {
          background-color: #f7fafc;
          padding: 15px 20px;
          border-radius: 12px;
          margin-bottom: 12px;
          border-left: 4px solid #16a0a0;
        }
        .feature-title {
          font-weight: 700;
          color: #0e6363;
          margin-bottom: 5px;
        }
        .feature-desc {
          font-size: 14px;
          color: #718096;
          margin: 0;
        }
        .btn-wrapper {
          text-align: center;
          margin: 35px 0 15px 0;
        }
        .btn {
          display: inline-block;
          background: linear-gradient(135deg, #16a0a0, #0e6363);
          color: #ffffff !important;
          text-decoration: none;
          padding: 14px 32px;
          border-radius: 16px;
          font-weight: 700;
          font-size: 16px;
          box-shadow: 0 4px 15px rgba(22, 160, 160, 0.3);
          transition: transform 0.2s ease;
        }
        .footer {
          background-color: #f7fafc;
          padding: 25px;
          text-align: center;
          font-size: 13px;
          color: #a0aec0;
          border-top: 1px solid #edf2f7;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
            </svg>
          </div>
          <h1>MindEase</h1>
          <p>Selamat Datang di Keluarga Besar Kami</p>
        </div>
        <div class="content">
          <div class="greeting">Selamat bergabung, ${username}! 🎉</div>
          <p class="message">
            Terima kasih telah mendaftarkan diri dan mempercayakan kesehatan mental serta emosionalmu bersama MindEase. Kami di sini untuk menjadi ruang aman yang menemanimu setiap hari.
          </p>
          <p class="message" style="font-weight: 600;">
            Berikut adalah beberapa fitur utama yang siap membantumu menjaga keseimbangan mental:
          </p>
          <ul class="feature-list">
            <li class="feature-item">
              <div class="feature-title">📊 Refleksi Harian (Daily Mood Check-in)</div>
              <p class="feature-desc">Catat perasaanmu setiap hari untuk mengenali pola suasana hati dan tingkat kecemasanmu.</p>
            </li>
            <li class="feature-item">
              <div class="feature-title">💬 Safe Space (Komunitas Anonim)</div>
              <p class="feature-desc">Bagikan keluh kesah dan ceritamu secara anonim tanpa takut dihakimi oleh siapa pun.</p>
            </li>
            <li class="feature-item">
              <div class="feature-title">🤖 AI Mental Health Chatbot</div>
              <p class="feature-desc">Teman curhat pintar yang siap mendengarmu 24 jam dengan analisis risiko kelelahan emosional yang objektif.</p>
            </li>
          </ul>
          <p class="message">
            Mari mulai langkah pertamamu menuju kesehatan mental yang lebih baik hari ini!
          </p>
          <div class="btn-wrapper">
            <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}" class="btn">Mulai Jelajahi MindEase</a>
          </div>
        </div>
        <div class="footer">
          <p style="margin: 0 0 8px 0;">Email ini dikirim secara otomatis oleh sistem pendaftaran MindEase.</p>
          <p style="margin: 0;">&copy; 2026 MindEase. Dibuat dengan 💚 untuk kesehatan mental Anda.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

const sendWelcomeEmail = async (email, username) => {
  console.log(`[EmailService] Memulai pengiriman email selamat datang ke: ${email}`);

  const transporter = getTransporter();
  const mailOptions = {
    from: process.env.SMTP_FROM || '"MindEase" <welcome@mindease.com>',
    to: email,
    subject: 'Selamat Datang di MindEase, Tempat Aman Curahan Hatimu! 🎉💚',
    html: getWelcomeEmailTemplate(username)
  };

  if (transporter) {
    try {
      await transporter.sendMail(mailOptions);
      console.log(`[EmailService] 📧 Email selamat datang berhasil terkirim ke: ${email}`);
      return { success: true, type: 'real' };
    } catch (err) {
      console.error(`[EmailService] Gagal mengirim email selamat datang ke ${email} (${err.message}). Beralih ke simulasi...`);
    }
  }

  // Fallback log console jika gagal/SMTP tidak diatur
  console.log(`\n==================================================`);
  console.log(`🎉 [SIMULASI EMAIL SELAMAT DATANG]`);
  console.log(`   Penerima : ${username} (${email})`);
  console.log(`   Subjek   : ${mailOptions.subject}`);
  console.log(`   Status   : Email dicetak karena pengiriman email asli gagal/belum diatur.`);
  console.log(`==================================================\n`);
  return { success: true, type: 'simulation' };
};

module.exports = {
  sendDailyMoodReminders,
  sendResetPasswordEmail,
  sendWelcomeEmail
};

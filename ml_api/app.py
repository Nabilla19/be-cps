from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Any, Optional
import json
import tensorflow as tf
import numpy as np
import pandas as pd
import joblib
from fastapi.middleware.cors import CORSMiddleware
import os
from groq import Groq
import pickle
import re
from nltk.corpus import stopwords
from Sastrawi.Stemmer.StemmerFactory import StemmerFactory

from dotenv import load_dotenv
from pathlib import Path
load_dotenv(dotenv_path=Path(__file__).parent.parent / '.env')

# Setup Groq API
groq_client = Groq(api_key=os.environ.get("GROQ_API_KEY"))
GROQ_MODEL = "llama-3.3-70b-versatile"

app = FastAPI(title="MindEase AI API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 1. Load Model & Preprocessor
try:
    model = tf.keras.models.load_model('model_mindease_final.keras')
    print("Model Loaded Successfully!")
    
    preprocessor = joblib.load('preprocessor.pkl')
    encoders = preprocessor['encoders']
    scaler = preprocessor['scaler']
    scaler_y = preprocessor.get('scaler_y', None)
    feature_names = preprocessor['feature_names']
    print("Preprocessor Loaded Successfully!")
except Exception as e:
    print(f"Error Loading Model/Preprocessor: {e}")

# 1.5 Load Profanity Model & Preprocessor
try:
    with open('model/sentiment_model.pkl', 'rb') as f:
        profanity_model = pickle.load(f)
    with open('model/tfidf_vectorizer.pkl', 'rb') as f:
        profanity_tfidf = pickle.load(f)
        
    factory = StemmerFactory()
    stemmer = factory.create_stemmer()
    profanity_stop_words = set(stopwords.words('indonesian'))
    print("Profanity Model & Vectorizer Loaded Successfully!")
except Exception as e:
    print(f"Error Loading Profanity Model: {e}")

def preprocess_profanity(text):
    text = str(text).lower()
    text = re.sub(r'http\S+', '', text)
    text = re.sub(r'@\w+|#\w+', '', text)
    text = re.sub(r'USER|RT', '', text)
    text = re.sub(r'[^a-zA-Z\s]', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    tokens = text.split()
    tokens = [w for w in tokens if w not in profanity_stop_words]
    tokens = [stemmer.stem(w) for w in tokens]
    return ' '.join(tokens)

# 2. Schema Input
class HealthData(BaseModel):
    features: dict

class ProfanityRequest(BaseModel):
    text: str

# Schema untuk Chat
# history bisa berupa dict (currentState dari frontend) atau list
class ChatMessage(BaseModel):
    message: str
    history: Optional[Any] = None  # Bisa dict (21 fitur) atau list

class TitleRequest(BaseModel):
    message: str

# Schema untuk Asesmen Akhir (Poin 4)
class AssessmentRequest(BaseModel):
    risk_level: str
    burnout_score: float
    conversation_summary: str = ""

# 3. Nilai Default (Imputation) jika user tidak melengkapi data
DEFAULT_VALUES = {
    'age': 20,
    'gender': 'Female',
    'academic_year': 3,
    'study_hours_per_day': 4.0,
    'exam_pressure': 5.0,
    'academic_performance': 70.0,
    'stress_level': 5.0,
    'anxiety_score': 5.0,
    'depression_score': 5.0,
    'sleep_hours': 6.0,
    'physical_activity': 2.0,
    'social_support': 5.0,
    'screen_time': 6.0,
    'internet_usage': 6.0,
    'financial_stress': 5.0,
    'family_expectation': 5.0,
    'sleep_category': 'Cukup',
    'screen_time_category': 'Normal',
    'stress_category': 'Medium',
    'mental_risk_score': 3.0,
    'support_category': 'Low Support'
}

# === POIN 2: Kata kunci krisis / darurat ===
CRISIS_KEYWORDS = [
    "bunuh diri", "ingin mati", "mau mati", "tidak mau hidup", "mau bunuh",
    "mengakhiri hidup", "tidak ada gunanya hidup", "lebih baik mati",
    "pengen mati", "pengin mati", "pengen bunuh diri", "pengin bunuh diri",
    "sudah tidak mau hidup", "capek hidup", "muak hidup", "benci hidup",
    "self harm", "menyakiti diri", "nyakitin diri", "saya mau pergi selamanya"
]

def detect_crisis(message: str) -> bool:
    """Deteksi apakah pesan mengandung kata kunci krisis/darurat."""
    message_lower = message.lower()
    return any(keyword in message_lower for keyword in CRISIS_KEYWORDS)

CRISIS_RESPONSE = {
    "is_crisis": True,
    "reply": (
        "Hei, saya mendengarmu. Apa yang kamu rasakan sekarang sangat berat, "
        "dan saya benar-benar khawatir dengan keadaanmu. "
        "Kamu tidak harus melewati ini sendirian — ada orang yang peduli padamu "
        "dan siap mendengarkan kapan saja. Tolong hubungi salah satu bantuan di bawah ini sekarang ya."
    ),
    "extractedFeatures": {},
    "action": "SHOW_EMERGENCY_CONTACTS",
    "hotlines": [
        {"name": "Into The Light Indonesia", "number": "119", "ext": "ext 8", "hours": "24 jam"},
        {"name": "Yayasan Pulih", "number": "02178842580", "display": "(021) 788-42580", "hours": "Senin–Jumat"},
        {"name": "Hotline Kemenkes", "number": "1500454", "display": "1500-454", "hours": "24 jam"},
    ]
}

# === POIN 4: Mapping Asesmen Mental Health ===
def get_mental_health_assessment(risk_level: str, burnout_score: float) -> dict:
    """
    Menghasilkan asesmen kesehatan mental edukatif berdasarkan prediksi model.
    BUKAN diagnosis medis klinis.
    """
    # Tentukan kondisi berdasarkan kombinasi risk + burnout
    if risk_level == "High" and burnout_score >= 7.0:
        condition = "Kelelahan Mental Berat (Severe Burnout)"
        condition_desc = (
            "Kamu menunjukkan tanda-tanda kelelahan emosional yang sangat intens. "
            "Ini bisa mencakup rasa putus asa, kehilangan motivasi total, "
            "dan kesulitan menjalani aktivitas sehari-hari."
        )
        urgency = "Tinggi"
        color = "red"
        recommendation_action = "Sangat disarankan segera berbicara dengan psikolog atau konselor profesional."
    elif risk_level == "High" and burnout_score < 7.0:
        condition = "Tekanan Mental Signifikan (High Stress)"
        condition_desc = (
            "Kamu sedang berada di bawah tekanan yang cukup besar. "
            "Ada tanda-tanda stres kronis yang jika dibiarkan dapat berkembang "
            "menjadi kondisi yang lebih serius."
        )
        urgency = "Sedang-Tinggi"
        color = "orange"
        recommendation_action = "Pertimbangkan untuk berkonsultasi dengan konselor atau psikolog dalam waktu dekat."
    elif risk_level == "Medium":
        condition = "Kelelahan Emosional Sedang (Moderate Burnout)"
        condition_desc = (
            "Kamu menunjukkan beberapa tanda kelelahan emosional yang perlu diperhatikan. "
            "Mungkin kamu merasa lebih mudah lelah, kurang bersemangat, "
            "atau sulit fokus belakangan ini."
        )
        urgency = "Sedang"
        color = "yellow"
        recommendation_action = "Luangkan waktu untuk self-care dan pertimbangkan berbicara dengan orang yang kamu percaya."
    else:
        condition = "Kondisi Mental Relatif Stabil"
        condition_desc = (
            "Kamu tampaknya sedang dalam kondisi yang cukup baik secara emosional. "
            "Tetap jaga keseimbangan antara aktivitas dan istirahat ya."
        )
        urgency = "Rendah"
        color = "green"
        recommendation_action = "Pertahankan kebiasaan baik dan tetap terhubung dengan orang-orang yang mendukungmu."

    return {
        "condition": condition,
        "condition_description": condition_desc,
        "urgency_level": urgency,
        "color_indicator": color,
        "recommendation_action": recommendation_action,
        "disclaimer": (
            "⚠️ Ini adalah asesmen awal berbasis AI, BUKAN diagnosis medis klinis. "
            "Untuk evaluasi yang akurat, silakan berkonsultasi dengan psikolog atau psikiater berlisensi."
        )
    }

@app.get("/")
def home():
    return {"message": "MindEase AI API is Running", "status": "Ready"}

# === ENDPOINT CHAT TERPUSAT — Safety + Feature Extraction + Groq ===
@app.post("/chat")
def chat(data: ChatMessage):
    """
    Pusat kendali tunggal untuk semua logika percakapan AI.
    chatController.js (Node.js) hanya meneruskan request ke sini.
    - Safety Protocol: deteksi kata kunci krisis
    - Fix Looping: system prompt sadar konteks
    - Feature Extraction: ekstrak 21 fitur dari percakapan (format JSON)
    """
    user_message = data.message.strip()
    current_state = data.history  # history digunakan sebagai currentState dari frontend

    # === PRIORITAS TERTINGGI: Cek Krisis ===
    if detect_crisis(user_message):
        return {
            "reply": CRISIS_RESPONSE["reply"],
            "extractedFeatures": {},
            "is_crisis": True,
            "action": "SHOW_EMERGENCY_CONTACTS",
            "hotlines": CRISIS_RESPONSE["hotlines"]
        }

    # Tentukan fitur mana yang masih null/kosong
    null_features = []
    if isinstance(current_state, dict):
        null_features = [k for k, v in current_state.items() if v is None]
    
    next_question_hint = null_features[0] if null_features else None

    system_prompt = f"""Kamu adalah "MindEase AI", teman curhat yang empatik untuk mahasiswa Indonesia.

TUGASMU:
1. Balas dengan empati dan hangat (2-3 kalimat bahasa Indonesia santai).
2. {f'Di akhir, selipkan pertanyaan NATURAL untuk menggali info tentang: "{next_question_hint}"' if next_question_hint else 'Beritahu user bahwa datanya sudah lengkap dan akan segera dianalisis.'}
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

ATURAN WAJIB:
- JANGAN tanya ulang hal yang sudah dijawab user
- Jika user menjawab "iya/ya/betul/oke" → KONFIRMASI dan lanjut ke topik berikutnya
- Satu pertanyaan per giliran saja
- Validasi perasaan user SEBELUM bertanya hal teknis
- Jangan pernah merespons kata krisis (bunuh diri, mau mati) dengan pertanyaan biasa

PENTING: Hanya balas dengan JSON murni, tidak ada teks lain:
{{"reply": "balasan empati kamu", "extractedFeatures": {{"nama_fitur": nilai}}}}"""

    try:
        completion = groq_client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            response_format={"type": "json_object"},
            temperature=0.7,
            max_tokens=1024,
        )
        raw_text = completion.choices[0].message.content or ""
        
        # json sudah diimport di atas
        try:
            result = json.loads(raw_text)
        except Exception:
            result = {"reply": "Aku dengar kamu kok. Ceritakan lebih lanjut ya. 💙", "extractedFeatures": {}}

        # Sanitasi extractedFeatures: hapus nilai null/kosong
        clean_features = {
            k: v for k, v in (result.get("extractedFeatures") or {}).items()
            if v is not None and v != ""
        }

        return {
            "reply": result.get("reply", "Aku di sini untukmu. 💙"),
            "extractedFeatures": clean_features,
            "is_crisis": False,
            "action": "CONTINUE_CHAT"
        }

    except Exception as e:
        return {
            "reply": "Maaf, saya sedang mengalami gangguan teknis. Boleh kamu ceritakan lagi?",
            "extractedFeatures": {},
            "is_crisis": False,
            "action": "CONTINUE_CHAT"
        }

@app.post("/generate-title")
def generate_title(data: TitleRequest):
    """
    Menghasilkan judul singkat (1-3 kata) berdasarkan pesan pertama user.
    """
    try:
        prompt = (
            f"Buatkan judul percakapan sangat singkat (maksimal 3 kata) yang merangkum maksud dari kalimat ini:\n"
            f"\"{data.message}\"\n\n"
            f"PENTING: Hanya balas dengan judulnya saja. Tanpa tanda kutip, tanpa titik, tanpa pengantar."
        )
        
        chat_completion = groq_client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model=GROQ_MODEL,
            temperature=0.3,
            max_tokens=15,
        )
        title = chat_completion.choices[0].message.content.strip().replace('"', '').replace('.', '')
        if not title:
            title = "Obrolan Baru"
        return {"title": title}
    except Exception as e:
        return {"title": "Obrolan Baru"}



@app.post("/predict")
def predict(data: HealthData):
    input_dict = data.features
    
    # === RE-CALCULATE DERIVED FEATURES DYNAMICALLY ===
    # Mencegah kontradiksi data yang membingungkan Neural Network
    if input_dict.get('stress_level') is not None:
        s_val = float(input_dict['stress_level'])
        if s_val >= 8.0:
            input_dict['stress_category'] = 'High'
        elif s_val >= 4.0:
            input_dict['stress_category'] = 'Medium'
        else:
            input_dict['stress_category'] = 'Low'

    if input_dict.get('sleep_hours') is not None:
        sl_val = float(input_dict['sleep_hours'])
        if sl_val < 5.0:
            input_dict['sleep_category'] = 'Kurang'
        elif sl_val <= 8.0:
            input_dict['sleep_category'] = 'Cukup'
        else:
            input_dict['sleep_category'] = 'Baik'

    if input_dict.get('social_support') is not None:
        su_val = float(input_dict['social_support'])
        if su_val < 5.0:
            input_dict['support_category'] = 'Low Support'
        else:
            input_dict['support_category'] = 'High Support'

    if input_dict.get('screen_time') is not None:
        sc_val = float(input_dict['screen_time'])
        if sc_val > 8.0:
            input_dict['screen_time_category'] = 'Tinggi'
        else:
            input_dict['screen_time_category'] = 'Normal'

    st_v = float(input_dict.get('stress_level') or 5.0)
    an_v = float(input_dict.get('anxiety_score') or 5.0)
    de_v = float(input_dict.get('depression_score') or 5.0)
    input_dict['mental_risk_score'] = round((st_v + an_v + de_v) / 3.0, 2)
    
    # Isi nilai yang kosong (null) dengan DEFAULT_VALUES (Imputation)
    for col in feature_names:
        if col not in input_dict or input_dict[col] is None:
            input_dict[col] = DEFAULT_VALUES.get(col, 0)
    
    # 1. Konversi ke DataFrame dengan urutan kolom yang benar
    df_input = pd.DataFrame([input_dict], columns=feature_names)
    
    # 2. Apply LabelEncoder ke kolom kategorikal
    categorical_cols = list(encoders.keys())
    for col, le in encoders.items():
        if col in df_input.columns:
            known_classes = set(le.classes_)
            df_input[col] = df_input[col].apply(lambda x: str(x) if x in known_classes else le.classes_[0])
            df_input[col] = le.transform(df_input[col])
    
    # 2b. Pastikan semua kolom NUMERIK (non-kategorikal) bertipe float
    for col in feature_names:
        if col not in categorical_cols:
            try:
                df_input[col] = pd.to_numeric(df_input[col], errors='coerce').fillna(DEFAULT_VALUES.get(col, 0))
            except Exception:
                df_input[col] = DEFAULT_VALUES.get(col, 0)
            
    # 3. Apply MinMaxScaler
    X_scaled = scaler.transform(df_input)
    
    # Inference
    predictions = model.predict(X_scaled)
    
    # Parsing Results
    risk_probs = predictions[0][0]
    burnout_scaled = float(predictions[1][0][0])
    
    if scaler_y is not None:
        burnout_score = float(scaler_y.inverse_transform([[burnout_scaled]])[0][0])
    else:
        burnout_score = burnout_scaled
    
    risk_idx = int(np.argmax(risk_probs))
    risk_labels = ['High', 'Low', 'Medium']
    risk_level = risk_labels[risk_idx]
    
    # === PENGAMAN RISIKO KRISIS (SAFETY OVERWRITE) ===
    # Jika tingkat stres, kecemasan, atau depresi kualitatif dideteksi sangat tinggi (>= 8.0),
    # demi keselamatan psikologis mahasiswa, kita wajib menetapkan tingkat risiko sebagai "High" (Waspada)
    # dan memastikan skor burnout merefleksikan tingkat keparahan tersebut (min 7.5).
    stress_val = float(input_dict.get('stress_level', 5.0))
    anxiety_val = float(input_dict.get('anxiety_score', 5.0))
    dep_val = float(input_dict.get('depression_score', 5.0))
    
    if stress_val >= 8.0 or anxiety_val >= 8.0 or dep_val >= 8.0:
        risk_level = "High"
        max_core = max(stress_val, anxiety_val, dep_val)
        burnout_score = max(burnout_score, float(max_core * 0.95))
    
    # === POIN 4: Hasilkan Asesmen Mental Health ===
    assessment = get_mental_health_assessment(risk_level, burnout_score)
    
    # Memanggil Groq Llama untuk rekomendasi yang lebih natural dan manusiawi
    try:
        level_map = {'High': 'tinggi', 'Medium': 'sedang', 'Low': 'rendah'}
        level_indo = level_map.get(risk_level, risk_level)
        prompt = (
            f"Kamu adalah konselor kesehatan mental yang hangat dan penuh empati. "
            f"Seorang mahasiswa baru saja selesai berbagi cerita dan sistem kami menilai "
            f"tingkat risiko mentalnya {level_indo} dengan skor burnout {burnout_score:.1f} dari 10. "
            f"Kondisi yang terdeteksi: {assessment['condition']}. "
            f"Tulis 2-3 kalimat pesan personal yang terasa TULUS dan HANGAT untuknya. "
            f"Jangan sebut angka atau skor apapun. Jangan mulai dengan kata 'Berdasarkan' atau 'Analisis'. "
            f"Langsung sapa jiwanya seolah kamu sudah mendengar semua ceritanya. "
            f"Gunakan bahasa Indonesia yang santai, bukan formal."
        )
        
        chat_completion = groq_client.chat.completions.create(
            messages=[
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
            model=GROQ_MODEL,
            temperature=0.7,
            max_tokens=256,
        )
        ai_recommendation = chat_completion.choices[0].message.content.strip()
    except Exception as e:
        if risk_level == "High":
            ai_recommendation = "Kamu terdeteksi sedang berada di bawah tekanan mental yang sangat tinggi. Sangat disarankan untuk beristirahat sejenak, melakukan teknik pernapasan dalam, dan berbicara dengan konselor atau orang terdekat untuk meredakan kecemasanmu."
        elif risk_level == "Medium":
            ai_recommendation = "Ada beberapa tanda kelelahan emosional sedang. Cobalah untuk membagi waktu dengan lebih seimbang antara belajar dan bersantai, serta beristirahatlah yang cukup."
        else:
            ai_recommendation = "Keadaan emosionalmu tampak cukup stabil. Tetap pertahankan pola hidup seimbang dan luangkan waktu untuk relaksasi ya."
    
    return {
        "risk_level": risk_level,
        "burnout_score": round(burnout_score, 2),
        "probabilities": {
            "high": round(float(risk_probs[0]), 4),
            "low": round(float(risk_probs[1]), 4),
            "medium": round(float(risk_probs[2]), 4)
        },
        "genai_recommendation": ai_recommendation,
        # Poin 4: Asesmen Mental Health
        "mental_health_assessment": assessment
    }

# === POIN 4: Endpoint Asesmen Standalone (bisa dipanggil terpisah) ===
@app.post("/assessment")
def get_assessment(data: AssessmentRequest):
    """
    Endpoint untuk mendapatkan asesmen mental health secara standalone,
    setelah prediksi selesai dilakukan.
    """
    assessment = get_mental_health_assessment(data.risk_level, data.burnout_score)
    return assessment

# === Endpoint Check Profanity ===
@app.post("/check-profanity")
def check_profanity(input_data: ProfanityRequest):
    """
    Mengecek apakah kalimat mengandung kata kasar menggunakan model NLP.
    Menggantikan server ML terpisah di port 7000.
    """
    try:
        clean = preprocess_profanity(input_data.text)
        vector = profanity_tfidf.transform([clean])
        result = profanity_model.predict(vector)[0]
        return {
            "text": input_data.text,
            "prediction": result,
            "is_appropriate": result == "sopan"
        }
    except Exception as e:
        print(f"Error Profanity Check: {e}")
        return {
            "text": input_data.text,
            "prediction": "sopan",
            "is_appropriate": True
        }

# Cara menjalankan: uvicorn app:app --reload

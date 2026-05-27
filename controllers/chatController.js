// Native fetch tersedia di Node.js 18+ — tidak perlu install node-fetch

const FASTAPI_URL = 'http://localhost:8000';

/**
 * chatAgent — Proxy tipis ke FastAPI /chat
 * Semua logika AI (safety protocol, feature extraction, Groq) ada di FastAPI.
 * Controller ini hanya meneruskan request dan mengembalikan response.
 */
exports.chatAgent = async (req, res) => {
    try {
        const response = await fetch(`${FASTAPI_URL}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: req.body.message,
                history: req.body.currentState  // currentState dikirim sebagai history ke FastAPI
            })
        });

        if (!response.ok) {
            throw new Error(`FastAPI error: ${response.status}`);
        }

        const data = await response.json();

        // Format response sesuai yang diharapkan frontend (Chatbot.jsx)
        // { reply, extractedFeatures, is_crisis, action }
        res.json(data);

    } catch (error) {
        console.error("chatAgent Proxy Error:", error.message);
        res.json({
            reply: "Aku dengar kamu kok. Ceritakan lebih lanjut, aku ada di sini untukmu. 💙",
            extractedFeatures: {},
            is_crisis: false,
            action: "CONTINUE_CHAT"
        });
    }
};

const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { authenticateToken, optionalAuthenticateToken } = require('../middleware/authMiddleware');

router.post('/agent', optionalAuthenticateToken, chatController.chatAgent);
router.get('/history', authenticateToken, chatController.getChatHistory);
router.post('/save-result', authenticateToken, chatController.saveChatResult);

// Rute untuk Sesi Obrolan (Chat Sessions)
router.get('/sessions', authenticateToken, chatController.getSessions);
router.post('/sessions', authenticateToken, chatController.createSession);
router.delete('/sessions/:id', authenticateToken, chatController.deleteSession);

module.exports = router;

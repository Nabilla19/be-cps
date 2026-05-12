const express = require('express');
const router = express.Router();
const moodController = require('../controllers/moodController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.get('/', authenticateToken, moodController.getMoods);
router.post('/', authenticateToken, moodController.createMood);

module.exports = router;

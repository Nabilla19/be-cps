const express = require('express');
const router = express.Router();
const postController = require('../controllers/postController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.get('/', postController.getPosts);
router.post('/', authenticateToken, postController.createPost);

module.exports = router;

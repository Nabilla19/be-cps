const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticateAdmin } = require('../middleware/authMiddleware');

router.get('/stats', authenticateAdmin, adminController.getStats);
router.get('/posts', authenticateAdmin, adminController.getPosts);
router.delete('/posts/:id', authenticateAdmin, adminController.deletePost);
router.get('/users', authenticateAdmin, adminController.getUsers);
router.delete('/users/:id', authenticateAdmin, adminController.deleteUser);
router.put('/make-admin/:username', adminController.makeAdmin);

module.exports = router;

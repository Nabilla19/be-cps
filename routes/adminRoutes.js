const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticateAdmin } = require('../middleware/authMiddleware');

router.get('/stats', authenticateAdmin, adminController.getStats);
router.get('/analytics', authenticateAdmin, adminController.getAnalytics);
router.get('/posts', authenticateAdmin, adminController.getPosts);
router.delete('/posts/:id', authenticateAdmin, adminController.deletePost);
router.post('/posts/bulk-delete', authenticateAdmin, adminController.bulkDeletePosts);
router.post('/channels', authenticateAdmin, adminController.createChannel);
router.delete('/channels/:slug', authenticateAdmin, adminController.deleteChannel);
router.get('/users', authenticateAdmin, adminController.getUsers);
router.delete('/users/:id', authenticateAdmin, adminController.deleteUser);
router.post('/users', authenticateAdmin, adminController.addUser);
router.put('/users/:id/role', authenticateAdmin, adminController.updateUserRole);
router.put('/make-admin/:username', adminController.makeAdmin);

module.exports = router;


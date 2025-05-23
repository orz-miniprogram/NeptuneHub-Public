const express = require('express');
const router = express.Router();
const Queue = require('bullmq').Queue;
const redisConnection = require('../config/redis');

// Create a dedicated queue for notifications
const notificationQueue = new Queue('notificationQueue', { connection: redisConnection });

// Endpoint to receive notification requests (This remains part of the router)
router.post('/send', async (req, res) => {
  const { recipientUserIds, messageKey, data } = req.body;

  if (!recipientUserIds || !Array.isArray(recipientUserIds) || recipientUserIds.length === 0 || !messageKey) {
    return res.status(400).json({ message: 'Invalid request payload.' });
  }

  try {
    for (const userId of recipientUserIds) {
      await notificationQueue.add('sendNotification', {
        userId: userId,
        messageKey: messageKey,
        data: data
      }, {
        jobId: `notify-${messageKey}-match-${data?.matchId}-user-${userId}-${Date.now()}`,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        }
      });
    }
    res.status(202).json({ message: 'Notification jobs enqueued.' });
  } catch (error) {
    console.error('Error enqueuing notification jobs:', error);
    res.status(500).json({ message: 'Failed to enqueue notification jobs.' });
  }
});

module.exports = router; // Export the router
module.exports.notificationQueue = notificationQueue; // <--- Export the queue instance directly

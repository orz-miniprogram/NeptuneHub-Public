// In your Node.js backend (e.g., backend/routes/queue.js)

// NOTE: BullMQ (Node.js) and RQ (Python) cannot share jobs directly due to different job formats.
// You can use the same queue name (e.g., 'matchQueue') for monitoring, but jobs are not cross-compatible.

import express from 'express';
const router = express.Router();
const Queue = require('bullmq').Queue;
const matchQueue = new Queue('matchQueue', { connection: redisConnection }); // Your queue setup

// Assume your Node.js Redis connection config is available
const nodeRedisConnection = {
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
};

// Use the same queue name as Python for monitoring, but do not expect job compatibility
const pythonManagedQueue = new Queue('resource-processing', {
  connection: nodeRedisConnection,
});

router.get('/queue-status', async (req, res) => {
  try {
    console.log('Node.js Backend: Received request for queue status.');

    // Get counts of jobs in different states
    const counts = await pythonManagedQueue.getJobCounts();

    // Get jobs in specific states (optional, can be resource intensive for large queues)
    // const waitingJobs = await pythonManagedQueue.getJobs(['waiting'], { limit: 10 });
    // const failedJobs = await pythonManagedQueue.getJobs(['failed'], { limit: 10 });

    const queueStatus = {
      name: pythonManagedQueue.name,
      counts: counts, // { waiting: N, active: N, completed: N, failed: N, delayed: N, paused: N }
      // recentWaitingJobs: waitingJobs.map(job => ({ id: job.id, name: job.name, data: job.data })),
      // recentFailedJobs: failedJobs.map(job => ({ id: job.id, name: job.name, data: job.data, failedReason: job.failedReason })),
      // Add more details if needed
    };

    console.log('Node.js Backend: Sending queue status:', queueStatus.counts);
    res.json(queueStatus);

  } catch (error) {
    console.error('Node.js Backend: Error fetching queue status:', error);
    res.status(500).json({ message: 'Error retrieving queue status', error: error.message });
  }
});

// Add this router to your main Node.js Express app
// app.use('/api', queueRouter); // Example in your main Node.js app file

// You can add other endpoints here, e.g., to get status of a specific job by ID:
// router.get('/jobs/:jobId/status', async (req, res) => { /* ... logic ... */ });

async function scheduleCleanupJob() {
  const jobName = 'cleanupTimedOutMatches';
  const repeatOptions = {
    every: 60 * 60 * 1000, // Repeat every 1 hour (adjust frequency as needed)
    // or cron: '0 * * * *', // Use cron syntax for more control (e.g., every hour)
  };

  // Check if the job is already scheduled to avoid duplicates
  const repeatJobs = await matchQueue.getRepeatableJobs();
  const jobExists = repeatJobs.some(job => job.name === jobName);

  if (!jobExists) {
    await matchQueue.add(jobName, {}, {
      repeat: repeatOptions,
      jobId: `${jobName}-schedule` // Use a consistent jobId for the repeatable job
    });
    console.log(`Scheduled "${jobName}" job to run every hour.`);
  } else {
    console.log(`"${jobName}" job is already scheduled.`);
  }
}

// Call this function when your Node.js application starts up
scheduleCleanupJob();

module.exports = router;

# backend/python/scheduler_entry.py

import asyncio
import signal
import os
import sys
import time
import threading
from datetime import datetime, timedelta
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.events import EVENT_JOB_EXECUTED, EVENT_JOB_ERROR
import traceback
import logging
from pymongo.errors import ServerSelectionTimeoutError, ConnectionFailure

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

logger.info("Scheduler: Script starting...")

# Add the backend/python directory to the Python path
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
logger.info(f"Scheduler: Adding {parent_dir} to Python path")
sys.path.insert(0, parent_dir)

# Global flag for initialization
initialization_complete = threading.Event()

def wait_for_mongodb(max_retries=5, retry_delay=5):
    """Wait for MongoDB to become available"""
    retries = 0
    while retries < max_retries:
        try:
            # Import here to avoid circular imports
            from tasks.db import db_client
            # Test MongoDB connection
            db_client.server_info()
            logger.info("Successfully connected to MongoDB")
            return True
        except (ServerSelectionTimeoutError, ConnectionFailure) as e:
            retries += 1
            if retries == max_retries:
                logger.error(f"Failed to connect to MongoDB after {max_retries} attempts: {e}")
                return False
            logger.warning(f"MongoDB connection attempt {retries} failed, retrying in {retry_delay} seconds...")
            time.sleep(retry_delay)
    return False

try:
    logger.info("Scheduler: Waiting for MongoDB connection...")
    if not wait_for_mongodb():
        raise Exception("Failed to establish MongoDB connection")

    logger.info("Scheduler: Importing tasks...")
    # Import scheduled tasks from the new module
    from tasks.scheduled_tasks import (
        add_populate_potential_matches_job,
        add_assign_errand_job,
        add_auto_complete_match_cleanup_job
    )
    logger.info("Scheduler: Tasks imported successfully")

    logger.info("Scheduler: Importing queues...")
    # Import the queues for cleanup
    from worker.queue import resource_queue, auto_complete_match_queue, redis_connection
    logger.info("Scheduler: Queues imported successfully")
except Exception as e:
    logger.error(f"Scheduler: Import error: {e}")
    traceback.print_exc()
    sys.exit(1)

def init_timeout():
    """Wait for initialization to complete or timeout"""
    if not initialization_complete.wait(timeout=30):  # Wait 30 seconds max
        logger.error("Scheduler initialization timed out. Force exiting...")
        os._exit(1)

def cleanup_queues():
    """Clean up Redis queues on shutdown"""
    try:
        if resource_queue:
            resource_queue.empty()
        if auto_complete_match_queue:
            auto_complete_match_queue.empty()
        if redis_connection:
            redis_connection.close()
        logger.info("Queues cleaned up successfully")
    except Exception as e:
        logger.error(f"Error cleaning up queues: {e}")

def signal_handler(signum, frame):
    """Handle shutdown signals"""
    logger.info(f"Received signal {signum}")
    cleanup_queues()
    sys.exit(0)

# Register signal handlers
signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)

def job_listener(event):
    """Log job execution results"""
    if event.exception:
        logger.error(f'Job {event.job_id} failed: {event.exception}')
    else:
        logger.info(f'Job {event.job_id} executed successfully')

async def main():
    """Main scheduler function"""
    try:
        # Create scheduler
        scheduler = AsyncIOScheduler()
        scheduler.add_listener(job_listener, EVENT_JOB_EXECUTED | EVENT_JOB_ERROR)

        # Add jobs with appropriate intervals
        scheduler.add_job(
            add_populate_potential_matches_job,
            IntervalTrigger(minutes=10),
            id='populate_potential_matches',
            replace_existing=True
        )

        scheduler.add_job(
            add_assign_errand_job,
            IntervalTrigger(minutes=10, seconds=120),  # Run 2 minutes after populate_potential_matches
            id='assign_errand',
            replace_existing=True
        )

        scheduler.add_job(
            add_auto_complete_match_cleanup_job,
            IntervalTrigger(hours=24),  # Run daily
            id='auto_complete_match_cleanup',
            replace_existing=True
        )

        # Start the scheduler
        scheduler.start()
        initialization_complete.set()
        logger.info("Scheduler started successfully")

        # Keep the main thread alive
        while True:
            await asyncio.sleep(1)

    except Exception as e:
        logger.error(f"Error in scheduler main: {e}")
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    # Start timeout monitor in a separate thread
    threading.Thread(target=init_timeout, daemon=True).start()
    
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Scheduler stopped by user")
    except Exception as e:
        logger.error(f"Fatal error in scheduler: {e}")
        traceback.print_exc()
        sys.exit(1)

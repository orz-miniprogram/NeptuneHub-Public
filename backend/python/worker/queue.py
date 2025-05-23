# backend/python/worker/queue.py
# NOTE: This file uses Python RQ (Redis Queue), not BullMQ. Ensure queue names match those used in Node.js for cross-language compatibility.
# If you want to share queues between Node.js (BullMQ) and Python (RQ), be aware that their job formats are NOT compatible out of the box.
# Use this only for Python-side job management, not for direct BullMQ <-> RQ job sharing.

from rq import Queue
from config import REDIS_HOST, REDIS_PORT
import redis
import time
import atexit
import logging
from redis.backoff import ExponentialBackoff
from redis.retry import Retry
from redis.exceptions import ConnectionError, TimeoutError
import signal
import sys
import threading
from tasks.queue_tasks import handle_ClassifyResource_Job, handle_AutoCompleteMatch_Job

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Define queue names (matching what's used in Node.js queue.js and tasks.py)
RESOURCE_QUEUE_NAME = "matchQueue"  # Should match Node.js queue name if you want to monitor the same queue
AUTO_COMPLETE_MATCH_QUEUE_NAME = "auto_complete_match_queue"  # If you have a corresponding queue in Node.js
MAX_RETRIES = 5
RETRY_DELAY = 2  # seconds

# Global variables
redis_connection = None
resource_queue = None
auto_complete_match_queue = None
_shutdown_requested = False
_shutdown_event = threading.Event()

def signal_handler(signum, frame):
    """Handle shutdown signals gracefully"""
    global _shutdown_requested
    logger.info(f"Received signal {signum}, initiating graceful shutdown...")
    _shutdown_requested = True
    _shutdown_event.set()

# Register signal handlers
signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)

def wait_for_shutdown():
    """Wait for shutdown signal"""
    while not _shutdown_requested:
        try:
            _shutdown_event.wait(timeout=1.0)
        except Exception:
            pass

def get_redis_connection():
    """Establishes and returns a Redis connection with retries."""
    retry = Retry(ExponentialBackoff(), MAX_RETRIES)
    
    try:
        conn = redis.Redis(
            host=REDIS_HOST, 
            port=REDIS_PORT,
            socket_connect_timeout=30,
            socket_timeout=30,
            socket_keepalive=True,
            retry_on_timeout=True,
            health_check_interval=30,
            decode_responses=False,
            retry=retry,
            retry_on_error=[ConnectionError, TimeoutError]
        )
        # Test the connection
        conn.ping()
        logger.info(f"Successfully connected to Redis at {REDIS_HOST}:{REDIS_PORT}")
        return conn
    except redis.ConnectionError as e:
        logger.error(f"Failed to connect to Redis after {MAX_RETRIES} attempts: {e}")
        if not _shutdown_requested:  # Only raise if not shutting down
            raise
        return None
    except Exception as e:
        logger.error(f"Unexpected error connecting to Redis: {e}")
        if not _shutdown_requested:  # Only raise if not shutting down
            raise
        return None

def create_queue(name, redis_conn):
    """Creates a queue with proper settings and error handling."""
    try:
        queue = Queue(
            name,
            connection=redis_conn,
            default_timeout=600,  # 10 minutes
            result_ttl=600,      # Keep results for 10 minutes
            failure_ttl=24*3600, # Keep failed jobs for 24 hours
            job_timeout=300,     # Individual job timeout of 5 minutes
            is_async=True        # Ensure async operation
        )
        
        # Register task handlers
        if name == RESOURCE_QUEUE_NAME:
            queue.enqueue_call = handle_ClassifyResource_Job
        elif name == AUTO_COMPLETE_MATCH_QUEUE_NAME:
            queue.enqueue_call = handle_AutoCompleteMatch_Job
            
        return queue
    except Exception as e:
        logger.error(f"Error creating queue {name}: {e}")
        if not _shutdown_requested:  # Only raise if not shutting down
            raise
        return None

def close_queues():
    """Cleanup function to properly close queue connections."""
    global redis_connection
    try:
        if redis_connection:
            logger.info("Closing Redis connection...")
            redis_connection.close()
            redis_connection = None
            logger.info("Redis connection closed.")
    except Exception as e:
        logger.error(f"Error during queue cleanup: {e}")

def reconnect_redis():
    """Attempt to reconnect to Redis"""
    global redis_connection, resource_queue, auto_complete_match_queue
    try:
        if redis_connection:
            redis_connection.close()
        redis_connection = get_redis_connection()
        if redis_connection:
            resource_queue = create_queue(RESOURCE_QUEUE_NAME, redis_connection)
            auto_complete_match_queue = create_queue(AUTO_COMPLETE_MATCH_QUEUE_NAME, redis_connection)
            return True
    except Exception as e:
        logger.error(f"Failed to reconnect to Redis: {e}")
        return False

def keep_alive():
    """Keep the process alive and handle shutdown gracefully"""
    while not _shutdown_requested:
        try:
            # Periodically check Redis connection
            if redis_connection:
                try:
                    redis_connection.ping()
                except Exception as e:
                    logger.error(f"Redis connection error: {e}")
                    if not _shutdown_requested:
                        reconnect_redis()
            time.sleep(5)
        except Exception as e:
            logger.error(f"Error in keep_alive: {e}")
            if not _shutdown_requested:
                time.sleep(1)  # Avoid tight loop on errors

# Initialize queues
try:
    # Create the Redis connection instance (will be reused by all queues)
    redis_connection = get_redis_connection()
    
    # Create queue instances
    if redis_connection:
        resource_queue = create_queue(RESOURCE_QUEUE_NAME, redis_connection)
        auto_complete_match_queue = create_queue(AUTO_COMPLETE_MATCH_QUEUE_NAME, redis_connection)
        
        # Register cleanup function
        atexit.register(close_queues)
        
        logger.info("RQ Queues initialized successfully.")
        
        # Start keep-alive thread
        keep_alive_thread = threading.Thread(target=keep_alive, daemon=True)
        keep_alive_thread.start()
except Exception as e:
    logger.error(f"Failed to initialize RQ Queues: {e}")
    if redis_connection:
        close_queues()
    if not _shutdown_requested:  # Only raise if not shutting down
        raise

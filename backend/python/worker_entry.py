# backend/python/worker_entry.py
# This script runs the RQ worker process for resource and auto-complete match queues

import os
import sys
import time
import logging
from pathlib import Path
import signal
from functools import partial
import threading
import redis
from rq import Queue, Worker, Connection
import traceback

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Add the parent directory to Python path
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
sys.path.append(parent_dir)

# Import after path setup
from nlp.health import check_model_health
from nlp.models import initialize_models
from worker.queue import resource_queue, auto_complete_match_queue, redis_connection
from tasks.queue_tasks import handle_ClassifyResource_Job, handle_AutoCompleteMatch_Job

# Add initialization completion event
init_complete = threading.Event()

def init_timeout():
    if not init_complete.wait(timeout=30):  # Wait 30 seconds max
        logger.error("Worker initialization timed out. Force exiting...")
        os._exit(1)

def shutdown_handler(signum, frame):
    logger.info(f"\nReceived signal {signum}, shutting down worker gracefully...")
    try:
        if 'worker' in globals() and worker:
            logger.info("Worker: Stopping worker...")
            # Just set the flag and let the worker finish its current job
            worker._stop_requested = True
            logger.info("Worker: Worker stop requested.")
    except Exception as e:
        logger.error(f"Worker: Error during shutdown: {e}")
        traceback.print_exc()
    os._exit(0)

def exception_handler(type, value, tb):
    logger.error("Worker: Uncaught exception:")
    logger.error(f"Type: {type}")
    logger.error(f"Value: {value}")
    traceback.print_exception(type, value, tb)
    os._exit(1)

def main():
    """Main worker entry point"""
    global worker
    
    try:
        logger.info("Worker: Starting up...")
        
        # Initialize models with retries
        max_retries = 3
        retry_count = 0
        while retry_count < max_retries:
            if initialize_models() and check_model_health():
                break
            retry_count += 1
            if retry_count < max_retries:
                logger.warning(f"Model initialization attempt {retry_count} failed, retrying in 5 seconds...")
                time.sleep(5)
        
        if retry_count == max_retries:
            logger.error("Failed to initialize models after maximum retries")
            return 1
            
        logger.info("Worker: Testing Redis connection...")
        if not redis_connection:
            logger.error("Worker: Redis connection not established")
            return 1
            
        try:
            redis_connection.ping()
            logger.info("Worker: Successfully connected to Redis")
        except Exception as e:
            logger.error(f"Worker: Redis connection test failed: {e}")
            return 1
            
        # Create RQ worker
        logger.info("Worker: Creating RQ worker...")
        from rq import Worker
        
        worker = Worker(
            queues=[resource_queue, auto_complete_match_queue],
            connection=redis_connection,
            default_worker_ttl=420,  # 7 minutes - worker will be removed from registry if not heartbeat
            default_result_ttl=500,  # Keep results for a bit longer than worker TTL
            job_monitoring_interval=30,  # Check job status every 30 seconds
            queue_class=Queue,
            exception_handlers=[exception_handler],
            disable_default_exception_handler=True
        )
        
        logger.info("Worker: RQ Queues initialized.")
        logger.info(f"Worker: RQ Worker listening for jobs on queues: {[q.name for q in worker.queues]}")
        
        # Signal that initialization is complete before entering work loop
        init_complete.set()
        
        # Start worker with continuous operation
        worker.work(
            burst=False,  # Run continuously, don't exit after all jobs are done
            with_scheduler=True,  # Enable scheduler
            logging_level=logging.INFO,
            date_format='%Y-%m-%d %H:%M:%S',
            max_jobs=None  # No limit on number of jobs
        )
        
        return 0
        
    except Exception as e:
        logger.error(f"Worker: Unhandled error: {e}")
        return 1

if __name__ == "__main__":
    # Set up global exception handler
    sys.excepthook = exception_handler
    
    # Set up timeout for initialization
    timeout_thread = threading.Thread(target=init_timeout)
    timeout_thread.daemon = True
    timeout_thread.start()

    # Set up signal handlers
    signal.signal(signal.SIGINT, shutdown_handler)
    signal.signal(signal.SIGTERM, shutdown_handler)

    sys.exit(main())

# backend/python/tasks/scheduled_tasks.py
# This module contains all scheduled tasks that are run by the scheduler

from datetime import datetime, timedelta
from redis import Redis
from rq import Queue
from bson import ObjectId
import asyncio

# Import constants from config
from config import REDIS_HOST, REDIS_PORT

# Import database connection
from .db import (
    db_client,
    db,
    resource_collection,
    match_collection,
    users_collection,
    wallets_collection,
    errands_collection,
    runner_profile_collection
)

# Import queue tasks
from .queue_tasks import (
    populate_potential_matches_job,
    handle_AssignErrand_Job,
    handle_AutoCompleteMatch_Job,
    handle_CleanupTimedOutMatches_Job
)

# Queue names should match those in worker/queue.py
RESOURCE_QUEUE_NAME = "matchQueue"
AUTO_COMPLETE_MATCH_QUEUE_NAME = "auto_complete_match_queue"

# Redis Connection Setup with timeouts
redis_conn = Redis(
    host=REDIS_HOST, 
    port=REDIS_PORT,
    socket_connect_timeout=5,
    socket_timeout=5,
    retry_on_timeout=True
)

# Create queues with the correct names
resource_queue = Queue(RESOURCE_QUEUE_NAME, connection=redis_conn)
auto_complete_match_queue = Queue(AUTO_COMPLETE_MATCH_QUEUE_NAME, connection=redis_conn)

def add_populate_potential_matches_job():
    """
    Scheduled task that runs every 10 minutes.
    Adds a job to populate potential matches between resources.
    This runs 2 minutes before the assign_errand_job to ensure matches are populated before assignment.
    """
    print("Scheduler: Running scheduled task - Adding 'populatePotentialMatches' job to queue...")
    try:
        job = resource_queue.enqueue(
            'tasks.queue_tasks.populate_potential_matches_job',
            {},
            retry=1,
            result_ttl=300  # 5 minutes
        )
        print(f"Scheduler: Successfully added 'populatePotentialMatches' job {job.id} to queue.")
    except Exception as e:
        print(f"Scheduler: Error adding 'populatePotentialMatches' job to queue: {e}")

def add_assign_errand_job():
    """
    Scheduled task that runs every 10 minutes.
    Adds a job to assign errands after matches are populated.
    This runs 2 minutes after populate_potential_matches_job to ensure matches are ready.
    """
    print("Scheduler: Running scheduled task - Adding 'assignErrand' job to queue...")
    try:
        job = resource_queue.enqueue(
            'tasks.queue_tasks.handle_AssignErrand_Job',
            {},
            retry=3,
            result_ttl=300  # 5 minutes
        )
        print(f"Scheduler: Successfully added 'assignErrand' job {job.id} to queue.")
    except Exception as e:
        print(f"Scheduler: Error adding 'assignErrand' job to queue: {e}")

def add_auto_complete_match_cleanup_job():
    """
    Scheduled task that runs daily.
    Adds a job to clean up and auto-complete matches.
    """
    print("Scheduler: Running scheduled task - Adding 'auto_complete_match_job' to cleanup queue...")
    try:
        job = auto_complete_match_queue.enqueue(
            'tasks.queue_tasks.handle_AutoCompleteMatch_Job',
            {},
            retry=3,
            result_ttl=3600  # 1 hour
        )
        print(f"Scheduler: Successfully added 'auto_complete_match_job' {job.id} to queue.")
    except Exception as e:
        print(f"Scheduler: Error adding 'auto_complete_match_job' to queue: {e}")

def add_cleanup_timed_out_matches_job():
    """
    Scheduled task that runs daily.
    Adds a job to clean up timed out matches.
    """
    print("Scheduler: Running scheduled task - Adding 'cleanupTimedOutMatches' job to queue...")
    try:
        job = resource_queue.enqueue(
            'tasks.queue_tasks.handle_CleanupTimedOutMatches_Job',
            {},
            retry=3,
            result_ttl=3600  # 1 hour
        )
        print(f"Scheduler: Successfully added 'cleanupTimedOutMatches' job {job.id} to queue.")
    except Exception as e:
        print(f"Scheduler: Error adding 'cleanupTimedOutMatches' job to queue: {e}") 
# backend/python/scheduler_entry.py

import asyncio
import os
import signal
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

# Import the BullMQ queue instances
from worker.queue import resource_queue, auto_complete_match_queue

# Define the async function that will be the scheduled job for populating potential matches
async def add_populate_potential_matches_job():
    """
    This function is executed by the scheduler and adds a 'populatePotentialMatches' job to the queue.
    Expected to run frequently.
    """
    print("Scheduler: Running scheduled task - Adding 'populatePotentialMatches' job to queue...")
    try:
        job = await resource_queue.add('populatePotentialMatches', {}, { # Job name for the handler
            'attempts': 1,
            'removeOnComplete': True,
            'removeOnFail': True,
        })
        print(f"Scheduler: Successfully added 'populatePotentialMatches' job {job.id} to queue.")
    except Exception as e:
        print(f"Scheduler: Error adding 'populatePotentialMatches' job to queue: {e}")

# Define the async function that will be the scheduled job for assigning errands
async def add_assign_errand_job():
    """
    This function is executed by the scheduler and adds an 'assignErrand' job to the queue.
    Expected to run periodically after matching.
    """
    print("Scheduler: Running scheduled task - Adding 'assignErrand' job to queue...")
    try:
        job = await resource_queue.add('assignErrand', {}, { # Job name for the handler
            'attempts': 3, # Assignment might need retries
            'removeOnComplete': True,
            'removeOnFail': False, # Keep failed assignment jobs for inspection
        })
        print(f"Scheduler: Successfully added 'assignErrand' job {job.id} to queue.")
    except Exception as e:
        print(f"Scheduler: Error adding 'assignErrand' job to queue: {e}")

# (Existing) Define the async function for auto-completing matches
async def add_auto_complete_match_cleanup_job():
    """
    This function is executed by the scheduler and adds an 'auto_complete_match_job' to the queue.
    """
    print("Scheduler: Running scheduled task - Adding 'auto_complete_match_job' to cleanup queue...")
    try:
        job = await auto_complete_match_queue.add('auto_complete_match_job', {}, {
            'attempts': 3,
            'removeOnComplete': True,
            'removeOnFail': False,
        })
        print(f"Scheduler: Successfully added 'auto_complete_match_job' {job.id} to queue.")
    except Exception as e:
        print(f"Scheduler: Error adding 'auto_complete_match_job' to queue: {e}")


# --- Scheduler Setup ---
scheduler = AsyncIOScheduler()

# Add the 'populatePotentialMatches' scheduled job (replacing previous 'matchResources' if that was its purpose)
scheduler.add_job(
    add_populate_potential_matches_job,
    IntervalTrigger(hours=1), # Run every 5 minutes for matching
    id='populate_potential_matches_scheduled_job',
    replace_existing=True
)
print("Scheduler: Configured 'populatePotentialMatches' job to run periodically (every 5 minutes).")

# Add the 'assignErrand' scheduled job
scheduler.add_job(
    add_assign_errand_job,
    IntervalTrigger(minutes=10), # Run every 10 minutes for assignment (after matches are populated)
    id='assign_errand_scheduled_job',
    replace_existing=True
)
print("Scheduler: Configured 'assignErrand' job to run periodically (every 10 minutes).")

# Add the 'auto_complete_match_cleanup_job' scheduled job (existing)
scheduler.add_job(
    add_auto_complete_match_cleanup_job,
    IntervalTrigger(days=1), # Run daily for cleanup
    id='auto_complete_match_cleanup_scheduled_job',
    replace_existing=True
)
print("Scheduler: Configured 'auto_complete_match_cleanup_job' to run periodically (daily).")


# --- Entry point to run the scheduler ---
async def run_scheduler():
    print("Scheduler: Starting scheduler...")
    scheduler.start()
    print("Scheduler: Scheduler started. Jobs will run on their schedule.")

    while True:
        await asyncio.sleep(1)

# Basic signal handling for graceful shutdown
def shutdown_scheduler(signum, frame):
    print(f"\nScheduler: Received signal {signum}, shutting down scheduler gracefully...")
    if scheduler.running:
        scheduler.shutdown()
    print("Scheduler: Scheduler shut down.")
    try:
        asyncio.run(resource_queue.close())
        print("Scheduler: resource_queue closed.")
    except Exception as e:
        print(f"Scheduler: Error closing resource_queue: {e}")
    try:
        asyncio.run(auto_complete_match_queue.close())
        print("Scheduler: auto_complete_match_queue closed.")
    except Exception as e:
        print(f"Scheduler: Error closing auto_complete_match_queue: {e}")

    os._exit(0)

signal.signal(signal.SIGINT, shutdown_scheduler)
signal.signal(signal.SIGTERM, shutdown_scheduler)

if __name__ == "__main__":
    try:
        asyncio.run(run_scheduler())
    except (KeyboardInterrupt, SystemExit):
        print("Scheduler: Script interrupted by user or system.")
    except Exception as e:
        print(f"Scheduler: Unhandled exception in main loop: {e}")

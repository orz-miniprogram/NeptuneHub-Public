# backend/python/worker_entry.py
# This script runs the BullMQ worker process

import sys
import os

sys.path.insert(0, '/app')  # Ensure /app is at the beginning of the path

import asyncio
from bullmq import Worker
import signal

# Import queue names and connection setup
from worker import RESOURCE_QUEUE_NAME, AUTO_COMPLETE_MATCH_QUEUE_NAME, get_redis_connection

# Import handler functions from 'worker' package (assuming these are exported via __init__.py from tasks.py)
from worker.tasks import ( # <--- Adjust imports if these are in __init__.py
    process_job as handle_AutoCompleteMatch_Job,
    populate_potential_matches_job as handle_PopulatePotentialMatches_Job, # <--- NEW HANDLER IMPORT
    assignErrand_job as handle_AssignErrand_Job # <--- NEW HANDLER IMPORT
)

# Assuming other handlers like these are also defined in tasks.py or imported into __init__.py
# from worker.tasks import handle_ClassifyResource_Job # If it exists
# from worker.tasks import handle_CleanupTimedOutMatches_Job # If it exists
# For now, I'll use placeholders for these if they are not provided.
# If they exist, ensure you import them similarly.

# Let's define placeholder handlers for now, if you have actual ones replace these
async def handle_ClassifyResource_Job(job):
    print(f"Placeholder: ClassifyResource job {job.id}")
    # Your actual classification logic here
    pass

async def handle_CleanupTimedOutMatches_Job(job):
    print(f"Placeholder: CleanupTimedOutMatches job {job.id}")
    # Your actual cleanup logic here
    pass


from config import REDIS_HOST, REDIS_PORT # Import REDIS_HOST and REDIS_PORT

redis_connection = get_redis_connection()

# Define the handlers map for the RESOURCE_QUEUE_NAME worker
resource_handlers = {
    'classifyResource': handle_ClassifyResource_Job,
    'populatePotentialMatches': handle_PopulatePotentialMatches_Job, # <--- NEW HANDLER MAPPING
    'assignErrand': handle_AssignErrand_Job, # <--- NEW HANDLER MAPPING
    "cleanupTimedOutMatches": handle_CleanupTimedOutMatches_Job,
    # Any other existing jobs on RESOURCE_QUEUE_NAME
}

# Create the Worker instance for RESOURCE_QUEUE_NAME
resource_worker = Worker(
    RESOURCE_QUEUE_NAME,
    resource_handlers,
    connection=redis_connection
)

# Worker event listeners for resource_worker
resource_worker.on('active', lambda job: print(f"Worker [Resource]: Job {job.id} is active"))
resource_worker.on('completed', lambda job: print(f"Worker [Resource]: Job {job.id} completed"))
resource_worker.on('failed', lambda job, err: print(f"Worker [Resource]: Job {job.id} failed with error: {err}"))
resource_worker.on('progress', lambda job, progress: print(f"Worker [Resource]: Job {job.id} progress: {progress}"))
resource_worker.on('error', lambda err: print(f"Worker [Resource]: An error occurred: {err}"))

print(f"Worker Entry: BullMQ Resource Worker listening for jobs on queue '{RESOURCE_QUEUE_NAME}'...")

# --- Define and start the worker for auto_complete_match_queue ---
auto_complete_match_handlers = {
    'auto_complete_match_job': handle_AutoCompleteMatch_Job,
}

auto_complete_match_worker = Worker(
    AUTO_COMPLETE_MATCH_QUEUE_NAME,
    auto_complete_match_handlers,
    connection=redis_connection
)

# Worker event listeners for auto_complete_match_worker
auto_complete_match_worker.on('active', lambda job: print(f"Worker [Auto-Complete]: Job {job.id} is active"))
auto_complete_match_worker.on('completed', lambda job: print(f"Worker [Auto-Complete]: Job {job.id} completed"))
auto_complete_match_worker.on('failed', lambda job, err: print(f"Worker [Auto-Complete]: Job {job.id} failed with error: {err}"))
auto_complete_match_worker.on('progress', lambda job, progress: print(f"Worker [Auto-Complete]: Job {job.id} progress: {progress}"))
auto_complete_match_worker.on('error', lambda err: print(f"Worker [Auto-Complete]: An error occurred: {err}"))

print(f"Worker Entry: BullMQ Auto-Complete Worker listening for jobs on queue '{AUTO_COMPLETE_MATCH_QUEUE_NAME}'...")

# Async function to run all workers concurrently
async def run_all_workers():
    await asyncio.gather(
        resource_worker.run(),
        auto_complete_match_worker.run()
    )

# Basic signal handling for graceful shutdown
def shutdown_workers(signal, frame):
    print("\nWorker Entry: Received signal, shutting down workers gracefully...")
    resource_worker.close()
    auto_complete_match_worker.close()
    os._exit(0)

# Register signal handlers
signal.signal(signal.SIGINT, shutdown_workers)
signal.signal(signal.SIGTERM, shutdown_workers)

if __name__ == "__main__":
    try:
        asyncio.run(run_all_workers())
    except KeyboardInterrupt:
        print("Worker Entry: Keyboard interrupt received.")
    except Exception as e:
        print(f"Worker Entry: Unhandled exception in main loop: {e}")

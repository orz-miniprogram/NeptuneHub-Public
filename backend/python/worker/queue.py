# backend/python/worker/queue.py

from bullmq import Queue
from config import REDIS_HOST, REDIS_PORT
import redis

# Define queue names (matching what's used in tasks.py and scheduler_entry.py)
RESOURCE_QUEUE_NAME = "match_resources_queue" # Ensure this matches queue name in tasks.py
AUTO_COMPLETE_MATCH_QUEUE_NAME = "auto_complete_match_queue" # Ensure this matches queue name in tasks.py

def get_redis_connection():
    """Establishes and returns a Redis connection."""
    return redis.Redis(host=REDIS_HOST, port=REDIS_PORT)

# Create the Redis connection instance (will be reused by all queues)
redis_connection = get_redis_connection()

# Create the Queue instances, passing the connection explicitly
# THIS IS THE IMPORTANT CORRECTION: connection=redis_connection must be passed
resource_queue = Queue(RESOURCE_QUEUE_NAME, connection=redis_connection)
auto_complete_match_queue = Queue(AUTO_COMPLETE_MATCH_QUEUE_NAME, connection=redis_connection)

print("BullMQ Queues initialized.")

# You might want to add a cleanup function here if you manage Redis connections
# outside of the BullMQ library's internal handling, for example:
# async def close_all_queues():
#     await resource_queue.close()
#     await auto_complete_match_queue.close()
#     # If the redis_connection object needs explicit closing, do it here
#     # redis_connection.close() # For some redis clients, this might be necessary

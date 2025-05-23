# /app/worker/__init__.py

from .queue import RESOURCE_QUEUE_NAME, AUTO_COMPLETE_MATCH_QUEUE_NAME, get_redis_connection

# Note: Task implementations have been moved to the tasks package
# Import tasks from 'tasks' package instead of 'worker.task'

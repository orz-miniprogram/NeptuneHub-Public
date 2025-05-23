# backend/python/tasks/db.py

from pymongo import MongoClient
import logging
from config import MONGO_URI, MONGO_DB_NAME

# Configure logging
logger = logging.getLogger(__name__)

# MongoDB Connection Setup with timeouts
try:
    db_client = MongoClient(
        MONGO_URI,
        serverSelectionTimeoutMS=10000,  # 10 second timeout for server selection
        connectTimeoutMS=10000,          # 10 second timeout for initial connection
        socketTimeoutMS=10000,           # 10 second timeout for socket operations
        retryWrites=True,                # Enable retry writes
        retryReads=True,                 # Enable retry reads
        w='majority',                    # Write concern for replica sets
        readPreference='primaryPreferred' # Allow reads from secondaries if primary is unavailable
    )
    
    # Test the connection
    db_client.server_info()
    
    # Initialize database and collections
    db = db_client[MONGO_DB_NAME]
    resource_collection = db.resources
    match_collection = db.matches
    users_collection = db.users
    wallets_collection = db.wallets
    errands_collection = db.errands
    runner_profile_collection = db.runner_profiles
    
    logger.info(f"MongoDB connected to database '{MONGO_DB_NAME}'")
    
except Exception as e:
    logger.error(f"Failed to connect to MongoDB: {e}")
    db_client = None
    db = None
    resource_collection = None
    match_collection = None
    users_collection = None
    wallets_collection = None
    errands_collection = None
    runner_profile_collection = None
    raise

# Export all the database objects
__all__ = [
    'db_client',
    'db',
    'resource_collection',
    'match_collection',
    'users_collection',
    'wallets_collection',
    'errands_collection',
    'runner_profile_collection'
] 
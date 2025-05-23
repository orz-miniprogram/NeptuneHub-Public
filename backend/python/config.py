# backend/python/config.py

import os

# Redis connection details
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))

# MongoDB connection details
# For MongoDB Atlas: mongodb+srv://<username>:<password>@<cluster>.mongodb.net/
# For local/container MongoDB: mongodb://mongodb:27017/
MONGO_URI = os.getenv("MONGO_URI", "mongodb+srv://neptune-cluster.aaw90.mongodb.net/?retryWrites=true&w=majority")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "neptune-cluster")  # The actual database name to store collections

# Task and Job Settings
AUTO_COMPLETE_TIME_WINDOW_HOURS = int(os.getenv("AUTO_COMPLETE_TIME_WINDOW_HOURS", 24))
MATCH_BATCH_SIZE = int(os.getenv("MATCH_BATCH_SIZE", 1000))
MIN_MATCH_SCORE = float(os.getenv("MIN_MATCH_SCORE", 5.0))
MIN_REQUIRED_CREDITS = int(os.getenv("MIN_REQUIRED_CREDITS", 60))

# NLP Model Settings
# These can be overridden with environment variables if needed
SPACY_MODEL_NAME = os.getenv("SPACY_MODEL_NAME", "xx")  # Multilingual blank model
TRANSFORMER_MODEL_NAME = os.getenv("TRANSFORMER_MODEL_NAME", "xlm-roberta-base")  # Hugging Face model for spaCy transformer
SENTENCE_TRANSFORMER_MODEL_NAME = os.getenv("SENTENCE_TRANSFORMER_MODEL_NAME", "paraphrase-multilingual-MiniLM-L12-v2")

# API URLs and Endpoints (commented out as not currently used)
# FASTAPI_CLASSIFY_URL = os.getenv("FASTAPI_CLASSIFY_URL", "http://localhost:8000/classify")
# NODEJS_NOTIFICATION_URL = os.getenv("NODEJS_NOTIFICATION_URL", "http://node-backend:3000/api/notifications/send")

# backend/python/config.py

import os

# Redis connection details for BullMQ
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))

# FastAPI classification service URL (No longer needed if running NLP in worker)
# FASTAPI_CLASSIFY_URL = os.getenv("FASTAPI_CLASSIFY_URL", "http://localhost:8000/classify")

# MongoDB connection details for worker to access database
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "your_database_name") # Replace with your DB name

# NLP Model Names
SPACY_MODEL_NAME = "xx" # Multilingual blank model
TRANSFORMER_MODEL_NAME = "xlm-roberta-base" # Hugging Face model for spaCy transformer
SENTENCE_TRANSFORMER_MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2" # Sentence Transformer model

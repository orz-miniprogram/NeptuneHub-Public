# backend/python/nlp/models.py

import os
import spacy
from sentence_transformers import SentenceTransformer
from config import SPACY_MODEL_NAME, TRANSFORMER_MODEL_NAME, SENTENCE_TRANSFORMER_MODEL_NAME
import requests
import shutil
from pathlib import Path
import threading
import atexit
import logging
import time
import json
import pickle
from functools import wraps
from transformers import AutoConfig, AutoTokenizer, AutoModel
import torch
import warnings

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize models as None
nlp_pipeline = None
sentence_transformer_model = None

# Define cache directory for models
CACHE_DIR = os.path.join(os.path.dirname(__file__), "model_cache")
TRANSFORMER_CACHE = os.path.join(CACHE_DIR, "transformer_cache")
os.makedirs(CACHE_DIR, exist_ok=True)
os.makedirs(TRANSFORMER_CACHE, exist_ok=True)

# Set environment variables for HuggingFace
os.environ["TRANSFORMERS_CACHE"] = TRANSFORMER_CACHE
os.environ["HF_HOME"] = TRANSFORMER_CACHE
os.environ["SENTENCE_TRANSFORMERS_HOME"] = TRANSFORMER_CACHE

# Lock file for cross-process synchronization
LOCK_FILE = os.path.join(CACHE_DIR, ".model_init.lock")
STATE_FILE = os.path.join(CACHE_DIR, ".model_state.json")
SPACY_MODEL_STATE = os.path.join(CACHE_DIR, ".spacy_model.pkl")
TRANSFORMER_MODEL_STATE = os.path.join(CACHE_DIR, ".transformer_model.pkl")
MAX_WAIT_TIME = 300  # 5 minutes
HEALTH_CHECK_INTERVAL = 60  # 1 minute

# Flag to track if we're actually exiting
_is_exiting = False
_is_initialized = threading.Event()
_health_check_lock = threading.Lock()
_last_health_check = 0

def set_exiting():
    global _is_exiting
    _is_exiting = True

# Register the exit flag setter
atexit.register(set_exiting)

def ensure_models_loaded(func):
    """Decorator to ensure models are loaded before function execution"""
    @wraps(func)
    def wrapper(*args, **kwargs):
        if not _is_initialized.is_set():
            logger.info("Models not initialized, initializing now...")
            if not initialize_models():
                raise RuntimeError("Failed to initialize models")
        return func(*args, **kwargs)
    return wrapper

def check_model_health():
    """Check if models are healthy and reload if necessary"""
    global nlp_pipeline, sentence_transformer_model, _last_health_check
    
    current_time = time.time()
    
    # Only check health if enough time has passed since last check
    with _health_check_lock:
        if current_time - _last_health_check < HEALTH_CHECK_INTERVAL:
            return True
        _last_health_check = current_time
    
    try:
        # Test spaCy model
        if nlp_pipeline is None:
            raise RuntimeError("SpaCy model not loaded")
        test_text = "Test sentence for health check."
        _ = nlp_pipeline(test_text)
        
        # Test sentence transformer
        if sentence_transformer_model is None:
            raise RuntimeError("Sentence transformer model not loaded")
        _ = sentence_transformer_model.encode([test_text])
        
        logger.info("Health check passed successfully")
        return True
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        try:
            # Try to reload models from scratch
            _is_initialized.clear()  # Force full reinitialization
            if initialize_models():
                logger.info("Successfully reloaded models after health check failure")
                return True
        except Exception as reload_error:
            logger.error(f"Failed to reload models: {reload_error}")
        return False

class ProcessLock:
    def __init__(self, lockfile):
        self.lockfile = lockfile
        self.acquired = False
        
    def acquire(self):
        try:
            # Check for stale lock
            if os.path.exists(self.lockfile):
                try:
                    # Check if lock is stale (older than 5 minutes)
                    if time.time() - os.path.getmtime(self.lockfile) > 300:
                        logger.warning("Found stale lock file, removing...")
                        os.remove(self.lockfile)
                    else:
                        # Check if process in lock file is still running
                        with open(self.lockfile, 'r') as f:
                            pid = int(f.read().strip())
                        try:
                            os.kill(pid, 0)  # Check if process exists
                            return False  # Process is still running
                        except OSError:
                            logger.warning(f"Process {pid} no longer exists, removing stale lock...")
                            os.remove(self.lockfile)
                except (OSError, ValueError):
                    # If any error occurs while checking, assume lock is stale
                    logger.warning("Error checking lock file, removing...")
                    os.remove(self.lockfile)
            
            # Create new lock file
            with open(self.lockfile, 'x') as f:  # 'x' mode ensures atomic creation
                f.write(str(os.getpid()))
            self.acquired = True
            return True
        except FileExistsError:
            return False
        except Exception as e:
            logger.error(f"Error acquiring lock: {e}")
            return False
            
    def release(self):
        if self.acquired:
            try:
                os.remove(self.lockfile)
                self.acquired = False
            except Exception as e:
                logger.error(f"Error releasing lock: {e}")

class ModelState:
    @staticmethod
    def save(state):
        try:
            with open(STATE_FILE, 'w') as f:
                json.dump(state, f)
        except Exception as e:
            logger.error(f"Error saving model state: {e}")
    
    @staticmethod
    def load():
        try:
            if os.path.exists(STATE_FILE):
                with open(STATE_FILE, 'r') as f:
                    return json.load(f)
        except Exception as e:
            logger.error(f"Error loading model state: {e}")
        return {}

# Global initialization lock and state tracking
_init_lock = threading.Lock()
_model_locks = {
    'spacy': threading.Lock(),
    'transformer': threading.Lock()
}

def verify_model_files(path):
    """Verify that all necessary model files exist and are not empty"""
    if not os.path.exists(path):
        return False
    
    # Check if directory has content
    if os.path.isdir(path):
        files = list(Path(path).rglob('*'))
        if not files:  # Empty directory
            return False
        # Check if any file is empty
        return all(f.stat().st_size > 0 for f in files if f.is_file())
    return False

def clean_cache_dir(model_name):
    """Clean up potentially corrupted model files"""
    cache_path = os.path.join(CACHE_DIR, model_name.replace('/', '_'))
    if os.path.exists(cache_path):
        logger.info(f"Removing potentially corrupted model cache: {cache_path}")
        shutil.rmtree(cache_path, ignore_errors=True)

def download_spacy_model():
    """Download and cache spaCy model"""
    with _model_locks['spacy']:
        model_name = f"spacy_{SPACY_MODEL_NAME}"
        cache_path = os.path.join(CACHE_DIR, model_name)
        
        # First check if model exists in Docker volume
        if verify_model_files(cache_path):
            try:
                # Verify model is loadable
                nlp = spacy.load(cache_path)
                _ = nlp("Test loading")
                logger.info(f"Valid SpaCy model found in volume at {cache_path}")
                return cache_path
            except Exception as e:
                logger.warning(f"Found corrupt model in volume: {e}")
                # Will proceed to redownload
        
        logger.info(f"Downloading spaCy model: {SPACY_MODEL_NAME}")
        try:
            # Clean any corrupted files from volume
            clean_cache_dir(model_name)
            
            # Create blank model
            nlp = spacy.blank(SPACY_MODEL_NAME)
            
            # Save to Docker volume
            nlp.to_disk(cache_path)
            
            # Verify saved model
            try:
                test_nlp = spacy.load(cache_path)
                _ = test_nlp("Test saving")
                logger.info(f"SpaCy model cached in volume at {cache_path}")
                return cache_path
            except Exception as e:
                raise Exception(f"Failed to verify saved model: {e}")
                
        except Exception as e:
            logger.error(f"Error caching spaCy model: {e}")
            clean_cache_dir(model_name)
            raise

def download_sentence_transformer():
    """Download and cache Sentence Transformer model"""
    with _model_locks['transformer']:
        model_name = SENTENCE_TRANSFORMER_MODEL_NAME
        cache_path = os.path.join(CACHE_DIR, model_name.replace('/', '_'))
        
        # First check if model exists in Docker volume
        if verify_model_files(cache_path):
            try:
                # Verify model is loadable
                model = SentenceTransformer(cache_path)
                _ = model.encode(["Test loading"])
                logger.info(f"Valid model found in volume at {cache_path}")
                return cache_path
            except Exception as e:
                logger.warning(f"Found corrupt model in volume: {e}")
                # Will proceed to redownload
        
        logger.info(f"Downloading Sentence Transformer model: {model_name}")
        try:
            # Clean any corrupted files from volume
            clean_cache_dir(model_name)
            
            # Download model
            model = SentenceTransformer(model_name)
            
            # Save to Docker volume
            model.save(cache_path)
            
            # Verify saved model
            try:
                test_model = SentenceTransformer(cache_path)
                _ = test_model.encode(["Test saving"])
                logger.info(f"Model cached in volume at {cache_path}")
                return cache_path
            except Exception as e:
                raise Exception(f"Failed to verify saved model: {e}")
                
        except Exception as e:
            logger.error(f"Error caching model: {e}")
            clean_cache_dir(model_name)
            raise

def download_models():
    """Download all required models"""
    process_lock = ProcessLock(LOCK_FILE)
    start_time = time.time()
    
    while True:
        if process_lock.acquire():
            try:
                logger.info("Starting model downloads...")
                
                spacy_path = download_spacy_model()
                transformer_path = download_sentence_transformer()
                
                logger.info("\nAll models downloaded successfully!")
                logger.info(f"SpaCy model location: {spacy_path}")
                logger.info(f"Sentence Transformer model location: {transformer_path}")
                
                # Save successful state
                state = {'spacy_initialized': True, 'transformer_initialized': True}
                ModelState.save(state)
                
                return True
            except Exception as e:
                logger.error(f"\nError during model download: {e}")
                return False
            finally:
                process_lock.release()
        else:
            # Check if another process has already initialized the models
            state = ModelState.load()
            if state.get('spacy_initialized') and state.get('transformer_initialized'):
                # Verify the models actually exist
                spacy_path = os.path.join(CACHE_DIR, f"spacy_{SPACY_MODEL_NAME}")
                if verify_model_files(spacy_path):
                    logger.info("Models already initialized and verified")
                    return True
                else:
                    logger.warning("State file indicates initialization but models not found")
            
            # Check timeout
            if time.time() - start_time > MAX_WAIT_TIME:
                logger.error("Timeout waiting for model initialization")
                # Try to clean up potentially stale lock
                try:
                    if os.path.exists(LOCK_FILE):
                        os.remove(LOCK_FILE)
                except:
                    pass
                return False
            
            logger.info("Another process is initializing models, waiting...")
            time.sleep(5)

def save_model_state():
    """Save model state to disk"""
    global nlp_pipeline, sentence_transformer_model
    try:
        if nlp_pipeline and sentence_transformer_model:
            # Save paths instead of the models themselves
            state = {
                'spacy_path': os.path.join(CACHE_DIR, f"spacy_{SPACY_MODEL_NAME}"),
                'transformer_path': os.path.join(CACHE_DIR, SENTENCE_TRANSFORMER_MODEL_NAME.replace('/', '_')),
                'timestamp': time.time()
            }
            with open(STATE_FILE, 'w') as f:
                json.dump(state, f)
            logger.info("Saved model state successfully")
    except Exception as e:
        logger.error(f"Error saving model state: {e}")

def load_model_state():
    """Load model state from disk"""
    global nlp_pipeline, sentence_transformer_model
    try:
        if os.path.exists(STATE_FILE):
            with open(STATE_FILE, 'r') as f:
                state = json.load(f)
            
            # Check if state is recent (less than 1 hour old)
            if time.time() - state.get('timestamp', 0) > 3600:
                logger.warning("Model state is too old, will reload models")
                return False
            
            spacy_path = state.get('spacy_path')
            transformer_path = state.get('transformer_path')
            
            if not spacy_path or not transformer_path:
                return False
                
            if not os.path.exists(spacy_path) or not os.path.exists(transformer_path):
                logger.warning("Model paths from state file don't exist")
                return False
            
            try:
                # Load spaCy model
                nlp_pipeline = spacy.load(spacy_path)
                # Test spaCy model
                _ = nlp_pipeline("Test loading")
                
                # Load transformer model
                sentence_transformer_model = SentenceTransformer(transformer_path)
                # Test transformer model
                _ = sentence_transformer_model.encode(["Test loading"])
                
                logger.info("Successfully loaded and validated models from paths")
                return True
            except Exception as e:
                logger.error(f"Error loading models from paths: {e}")
                nlp_pipeline = None
                sentence_transformer_model = None
                return False
    except Exception as e:
        logger.error(f"Error loading model state: {e}")
    return False

def initialize_models():
    """Initialize NLP models."""
    global nlp_pipeline, sentence_transformer_model
    
    # Use global lock to prevent multiple initializations
    with _init_lock:
        try:
            # First try to load from saved state in volume
            state = ModelState.load()
            if state.get('spacy_initialized') and state.get('transformer_initialized'):
                logger.info("Found saved model state in volume, verifying models...")
                try:
                    spacy_path = os.path.join(CACHE_DIR, f"spacy_{SPACY_MODEL_NAME}")
                    transformer_path = os.path.join(CACHE_DIR, SENTENCE_TRANSFORMER_MODEL_NAME.replace('/', '_'))
                    
                    # Try loading both models
                    nlp_pipeline = spacy.load(spacy_path)
                    sentence_transformer_model = SentenceTransformer(transformer_path)
                    
                    # Quick verification
                    _ = nlp_pipeline("Test loading")
                    _ = sentence_transformer_model.encode(["Test loading"])
                    
                    logger.info("Successfully loaded models from volume")
                    _is_initialized.set()
                    return True
                except Exception as e:
                    logger.warning(f"Failed to load models from volume: {e}")
                    # Clear invalid state
                    ModelState.save({})
            
            # If we get here, we need to download models
            logger.info("Downloading and caching models...")
            
            # Download both models
            spacy_path = download_spacy_model()
            transformer_path = download_sentence_transformer()
            
            # Load the downloaded models
            nlp_pipeline = spacy.load(spacy_path)
            sentence_transformer_model = SentenceTransformer(transformer_path)
            
            # Set initialization flag and save state
            _is_initialized.set()
            state = {'spacy_initialized': True, 'transformer_initialized': True}
            ModelState.save(state)
            
            logger.info("Models initialized successfully")
            return True
            
        except Exception as e:
            logger.error(f"Error initializing models: {e}")
            return False

def cleanup():
    """Cleanup resources and save model state"""
    global nlp_pipeline, sentence_transformer_model
    
    # Only cleanup if we're actually exiting
    if not _is_exiting:
        return
        
    try:
        save_model_state()
        if nlp_pipeline:
            del nlp_pipeline
        if sentence_transformer_model:
            del sentence_transformer_model
        _is_initialized.clear()
        logger.info("Model resources cleaned up")
    except Exception as e:
        logger.error(f"Error during cleanup: {e}")

# Register cleanup function
atexit.register(cleanup)

# Initialize models on module import
if not initialize_models():
    logger.warning("Failed to initialize models on import, will retry when needed")

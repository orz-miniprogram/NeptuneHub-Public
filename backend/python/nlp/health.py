# backend/python/nlp/health.py

import os
import logging
from .models import CACHE_DIR, STATE_FILE, ModelState, nlp_pipeline, sentence_transformer_model

logger = logging.getLogger(__name__)

def check_model_health():
    """Check the health of NLP models"""
    try:
        # First check if models are in a valid state
        state = ModelState.load()
        if not state.get('spacy_initialized') or not state.get('transformer_initialized'):
            # Models are still initializing, this is not an error
            logger.info("Models are still initializing")
            return False
            
        # Check if models are initialized
        if not nlp_pipeline or not sentence_transformer_model:
            logger.error("Models not initialized")
            return False
            
        # Check model cache directory
        if not os.path.exists(CACHE_DIR):
            logger.error("Model cache directory not found")
            return False
            
        # Try simple operations with models
        try:
            # Test spaCy
            test_text = "Test sentence for health check"
            doc = nlp_pipeline(test_text)
            if not doc or not hasattr(doc, 'text'):
                logger.error("SpaCy model test failed - invalid doc object")
                return False
                
            # Verify doc has expected attributes and methods
            if not hasattr(doc, 'text') or not callable(getattr(doc, 'to_json', None)):
                logger.error("SpaCy model test failed - missing required attributes")
                return False
                
            # Test Transformer
            embeddings = sentence_transformer_model.encode([test_text])
            if embeddings is None or not hasattr(embeddings, 'shape') or embeddings.shape[0] == 0:
                logger.error("Transformer model test failed - invalid embeddings")
                return False
                
            # Test model methods
            if not callable(getattr(sentence_transformer_model, 'encode', None)):
                logger.error("Transformer model test failed - missing encode method")
                return False
                
            logger.info("Model health check passed successfully")
            return True
            
        except Exception as e:
            logger.error(f"Model test failed: {e}")
            return False
            
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return False 
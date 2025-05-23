# backend/python/nlp/models.py

import spacy
from sentence_transformers import SentenceTransformer
from config import SPACY_MODEL_NAME, TRANSFORMER_MODEL_NAME, SENTENCE_TRANSFORMER_MODEL_NAME
import os

# --- Global variables for loaded models ---
nlp_pipeline = None
sentence_transformer_model = None

# --- Function to load SpaCy pipeline with Transformer ---
def load_nlp_pipeline():
    global nlp_pipeline
    if nlp_pipeline is None:
        print("NLP Models: Loading multilingual spaCy pipeline...")
        try:
            nlp = spacy.blank(SPACY_MODEL_NAME)
            # Ensure spacy-transformers is installed in this Python environment
            nlp.add_pipe("transformer", config={"model": {"name": TRANSFORMER_MODEL_NAME}})
            # Optionally add other components if needed (e.g., NER)
            # nlp.add_pipe("ner") # Add NER component if you have a transformer-based NER model or plan to train one

            nlp_pipeline = nlp
            print("NLP Models: SpaCy pipeline loaded successfully.")
        except Exception as e:
            print(f"NLP Models: Error loading spaCy pipeline: {e}")
            # Depending on environment, you might want to raise the exception
            # or handle it (e.g., set a flag that NLP is unavailable)
            nlp_pipeline = None # Ensure it's None if loading failed
            raise # Re-raise the exception to signal failure


# --- Function to load Sentence Transformer model ---
def load_sentence_transformer_model():
    global sentence_transformer_model
    if sentence_transformer_model is None:
        print("NLP Models: Loading Sentence Transformer model...")
        try:
            # This will download the model files the first time
            model = SentenceTransformer(SENTENCE_TRANSFORMER_MODEL_NAME)
            sentence_transformer_model = model
            print("NLP Models: Sentence Transformer model loaded successfully.")
        except Exception as e:
            print(f"NLP Models: Error loading Sentence Transformer model: {e}")
            sentence_transformer_model = None
            raise # Re-raise the exception


# --- Call loading functions when this module is imported ---
# This ensures models are loaded when the worker process that imports this module starts
# Handle potential errors if models fail to load
try:
    load_nlp_pipeline()
    load_sentence_transformer_model()
except Exception as e:
    print("NLP Models: One or more NLP models failed to load on startup.")
    # The worker should handle the case where models are not loaded
    # Jobs requiring NLP might fail if models are None

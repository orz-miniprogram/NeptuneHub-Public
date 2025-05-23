#!/usr/bin/env python3
# Script to pre-download all required NLP models

from .models import initialize_models

def download_models():
    """Download all required models"""
    return initialize_models()

if __name__ == "__main__":
    success = download_models()
    if not success:
        exit(1) 
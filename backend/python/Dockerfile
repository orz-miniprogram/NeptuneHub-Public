FROM neptune-python-base

WORKDIR /app

# Explicitly copy the nlp directory AFTER base requirements
COPY nlp ./nlp

# Set PYTHONPATH to include the parent directory
ENV PYTHONPATH=/app

COPY . /app

RUN mkdir -p /app/worker
RUN touch /app/__init__.py
RUN touch /app/worker/__init__.py
RUN touch /app/nlp/__init__.py

CMD ["python", "/app/worker_entry.py"]
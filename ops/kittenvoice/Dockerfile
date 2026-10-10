FROM kittenvoice-base:1
RUN pip install -q --no-cache-dir fastapi==0.118.0 "uvicorn[standard]==0.37.0" python-multipart==0.0.20
WORKDIR /app
COPY service.py migrate.py /app/
ENV KV_DATA=/data KV_ENGINE=/engine/kitten-tts-2-cpp KV_PYPKG=/engine/KittenTTS KV_THREADS=4 PYTHONUNBUFFERED=1
EXPOSE 17493
CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "17493", "--workers", "1", "--log-level", "warning"]

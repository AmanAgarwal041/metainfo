# MetaInfo scraper service: Scrapling (rendering + crawling) behind FastAPI.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
 # Downloads Chromium and its system libraries for Scrapling's browser fetchers.
 && scrapling install \
 && rm -rf /root/.cache/pip

COPY app.py .

# Run as an unprivileged user (browsers live in the shared PLAYWRIGHT_BROWSERS_PATH).
RUN useradd --create-home scraper && chmod -R a+rX /ms-playwright && chown -R scraper /app
USER scraper

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/health')"
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]

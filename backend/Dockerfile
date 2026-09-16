# FreightProof SA — Backend Dockerfile
# Used for production builds. For local dev, run uvicorn directly.
# Build: docker build -t freightproof-backend .

FROM python:3.13-slim

WORKDIR /app

# Install system dependencies including JDK required by hedera-sdk-py (jnius bridge)
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    default-jdk \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

EXPOSE 8000

# Run the application.
#
# Deliberately NO --forwarded-allow-ips="*", and do not add one. It looks like the right
# thing behind a proxy, and it is the opposite:
#
#   * uvicorn already defaults proxy_headers=True with forwarded_allow_ips=127.0.0.1, so
#     it rewrites request.client ONLY for a loopback peer. Behind Railway/nginx the peer
#     is not loopback, so request.client stays the real socket peer — unforgeable.
#   * This app resolves the caller's IP at the APPLICATION layer instead
#     (core/client_ip.py), gated on RATE_LIMIT_TRUST_PROXY_HEADERS, because two different
#     consumers need it: the rate limiter's bucket key and the handover's receiver_ip
#     evidence field.
#   * Setting "*" here makes uvicorn rewrite request.client from a header ANY caller can
#     send. That silently destroys the fallback the application layer relies on when
#     RATE_LIMIT_TRUST_PROXY_HEADERS is false — the mode whose entire purpose is to use an
#     address that cannot be forged. The result is a rate limit anyone can reset and an
#     evidence field anyone can dictate, with nothing logged either way.
#
# One mechanism, one switch: configure proxy trust through RATE_LIMIT_TRUST_PROXY_HEADERS.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
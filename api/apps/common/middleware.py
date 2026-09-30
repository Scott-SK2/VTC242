import time

from prometheus_client import Counter, Histogram

REQUEST_LATENCY = Histogram(
    "vtc242_http_request_seconds", "Latence HTTP côté serveur", ["method", "status"]
)
REQUEST_COUNT = Counter("vtc242_http_requests_total", "Requêtes HTTP", ["method", "status"])


class MetricsMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        start = time.perf_counter()
        response = self.get_response(request)
        elapsed = time.perf_counter() - start
        status = str(response.status_code)
        REQUEST_LATENCY.labels(request.method, status).observe(elapsed)
        REQUEST_COUNT.labels(request.method, status).inc()
        response["Server-Timing"] = f"app;dur={elapsed * 1000:.1f}"
        return response

FROM python:3.7-alpine

COPY server.py /server.py
ENV PORT=80

HEALTHCHECK --interval=10s --timeout=3s --retries=3 --start-period=5s \
    CMD wget -q -O - http://localhost || exit 1
CMD ["python3", "/server.py"]
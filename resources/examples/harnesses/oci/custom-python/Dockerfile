FROM python:3.12-slim@sha256:05a994d2344eb364cc186910f4fc8786a38215f39f00d0acc25bff33a08f4177
COPY examples/harnesses/python-agent/main.py /opt/hexagon-agent/main.py
LABEL ai.hexagon.harness.protocol="hexagon-json-v1" ai.hexagon.harness.version="1.0.0"
ENTRYPOINT ["python3", "/opt/hexagon-agent/main.py"]

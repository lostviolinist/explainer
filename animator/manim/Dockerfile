# Sandbox for AI-written Manim code: the official Manim image (Manim CE, LaTeX, ffmpeg)
# plus a stdlib-only render server. Holds no secrets; compose puts it on a network
# with no internet access.
FROM manimcommunity/manim:stable
COPY server.py /animator/server.py
EXPOSE 8001
CMD ["python", "/animator/server.py"]

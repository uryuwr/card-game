# Card Game Full Stack Docker Image
# 使用 DaoCloud 镜像加速 (针对国内网络)
FROM docker.m.daocloud.io/node:20-bookworm

# 替换 apt 源为清华源 (加速 apt update)
RUN sed -i 's/deb.debian.org/mirrors.tuna.tsinghua.edu.cn/g' /etc/apt/sources.list.d/debian.sources && \
    sed -i 's/security.debian.org/mirrors.tuna.tsinghua.edu.cn/g' /etc/apt/sources.list.d/debian.sources

# Install Python, Supervisor, Cloudflared, and OpenCV dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    supervisor \
    curl \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgl1-mesa-glx \
    && rm -rf /var/lib/apt/lists/*

# Install cloudflared
RUN curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    -o /usr/local/bin/cloudflared && \
    chmod +x /usr/local/bin/cloudflared

WORKDIR /app

# Python dependencies (API Server)
COPY api-server/requirements.txt ./api-server/
# Install dependencies globally with --break-system-packages (使用清华源)
RUN pip3 install -r api-server/requirements.txt --break-system-packages -i https://pypi.tuna.tsinghua.edu.cn/simple
RUN pip3 install qrcode pillow --break-system-packages -i https://pypi.tuna.tsinghua.edu.cn/simple

# Node dependencies (Game Server & Client)
COPY game-server/package.json ./game-server/
COPY client/package.json ./client/

# 配置 npm 淘宝源
RUN npm config set registry https://registry.npmmirror.com

RUN cd game-server && npm install
RUN cd client && npm install

# Copy source code
COPY . .

# Create logs directory
RUN mkdir -p /app/logs

# Setup startup scripts
RUN chmod +x docker-entrypoint.sh
RUN cp supervisord.conf /etc/supervisord.conf

# Expose ports: API, Game, Client
EXPOSE 8000 3001 5173

# Environment Variables
ENV NODE_ENV=production
ENV ENABLE_TUNNEL=true
ENV DEV_MODE=false
ENV SHELL=/bin/bash

ENTRYPOINT ["/app/docker-entrypoint.sh"]

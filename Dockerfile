FROM node:22-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       git \
       bash \
       curl \
       ca-certificates \
       python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./

RUN npm install

COPY start.js ./
COPY src ./src

ENV NODE_ENV=production
ENV HOME=/data
ENV PI_WEB_NO_OPEN=1
# start.js derives PI_CODING_AGENT_DIR, the bind hostname and the internal port.

CMD ["node", "start.js"]

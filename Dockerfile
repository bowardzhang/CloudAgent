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

ENV NODE_ENV=production
ENV HOME=/data
ENV PI_CODING_AGENT_DIR=/data/.pi/agent
ENV PI_WEB_HOSTNAME=0.0.0.0
ENV PI_WEB_NO_OPEN=1

CMD ["node", "start.js"]

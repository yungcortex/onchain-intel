FROM node:22-slim

# Install Python + build tools for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv \
    build-essential make g++ \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps
RUN pip3 install --break-system-packages aiohttp

WORKDIR /app

# Copy package files first for caching
COPY package*.json ./

# Install Node deps (this compiles better-sqlite3 native module)
RUN npm ci --include=dev

# Copy source
COPY . .

# Build the frontend
RUN npx vite build

# Verify dist exists
RUN ls -la dist/

ENV NODE_ENV=production

# Render sets PORT dynamically
EXPOSE ${PORT:-3001}

CMD ["node", "server/index.js"]

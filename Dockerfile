FROM node:22-slim

# Install Python for the forensic audit tool
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps
RUN pip3 install --break-system-packages aiohttp

WORKDIR /app

# Copy package files and install Node deps
COPY package*.json ./
RUN npm ci

# Copy everything
COPY . .

# Copy the forensic tools
COPY public/data/ public/data/

# Build the frontend
RUN npm run build

# Expose port
EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

CMD ["npm", "start"]

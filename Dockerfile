FROM oven/bun:1.3 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Copy source
COPY src/ src/
COPY public/ public/
COPY tsconfig.json ./

# Expose port
ENV PORT=3000
EXPOSE 3000

# Start server
CMD ["bun", "run", "src/index.ts"]

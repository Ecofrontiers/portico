FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN addgroup -g 1001 portico && adduser -u 1001 -G portico -s /bin/sh -D portico
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json portico.yml ./
USER portico
EXPOSE 3040
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3040/health || exit 1
CMD ["node", "dist/index.js"]

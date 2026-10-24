FROM node:22-bookworm-slim AS node
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM eclipse-temurin:21-jdk-jammy AS engine
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY scripts/setup.mjs scripts/setup.mjs
COPY java-engine/src java-engine/src
RUN node scripts/setup.mjs

FROM docker:28-cli AS docker
FROM eclipse-temurin:21-jdk-jammy
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /app
COPY --from=node /app/node_modules node_modules
COPY --from=node /app/dist dist
COPY --from=node /app/package.json package.json
COPY --from=engine /app/java-engine java-engine
RUN groupadd --gid 10001 backend && useradd --uid 10001 --gid 10001 --no-create-home backend
USER 10001:10001
ENV HOST=0.0.0.0 PORT=3001
EXPOSE 3001
CMD ["node", "dist/server.js"]

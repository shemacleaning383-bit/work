# Blue Park — runs the Node server as-is (no build step, no runtime npm deps).
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    BLUEPARK_MODE=demo \
    SCREENSHOTS=off
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY fixtures ./fixtures
COPY web ./web
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server/main.ts"]

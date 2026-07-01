# 0gtown — built on 0G. Node 20 + pnpm.
# The engine (aigg-agent-kit) is fetched at its pinned commit inside the build so
# the image is self-contained and doesn't depend on the platform checking out git
# submodules. Set ZEROG_WALLET_PK (+ optionally ZEROG_SKIP_DEPOSIT=1) as platform
# secrets — never bake the key into the image.
FROM node:20-slim

# git (to fetch the engine) + toolchain for native deps (blake-hash)
RUN apt-get update && apt-get install -y --no-install-recommends \
      git python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN corepack enable

# Engine, pinned to match the kit submodule (replay + cognition + gamekit + npc-agent + onchain).
# Kept out of the later COPY via .dockerignore so it isn't clobbered.
RUN git clone https://github.com/jianmliu/aigg-agent-kit.git kit \
  && git -C kit checkout c4b6cf70b672be4972b7622b7764423a936932b3

# Install deps first for better layer caching (workspace resolves kit/packages/*).
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# App source (kit + node_modules excluded via .dockerignore).
COPY . .

ENV ZEROGTOWN_STORAGE=1 \
    ZEROG_NET=mainnet \
    PORT=8137
EXPOSE 8137

CMD ["pnpm", "0gtown"]

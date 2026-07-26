FROM node:24-alpine

ENV NODE_ENV=production

WORKDIR /quickchart

# Build chain for node-canvas (no musl prebuilds - compiles from source).
RUN apk add --no-cache --virtual .build-deps \
    build-base g++ python3 pkgconf \
    cairo-dev pango-dev libjpeg-turbo-dev giflib-dev librsvg-dev pixman-dev
# Runtime shared libraries and fonts.
RUN apk add --no-cache \
    cairo pango libjpeg-turbo giflib librsvg pixman fontconfig libmount \
    ttf-dejavu ttf-droid ttf-freefont ttf-liberation font-noto font-noto-emoji
RUN apk add --no-cache font-wqy-zenhei \
    || apk add --no-cache --repository https://dl-cdn.alpinelinux.org/alpine/edge/community font-wqy-zenhei

# The postinstall hook (scripts/patch-upsetjs-venn.js) must be present for npm ci.
COPY package.json package-lock.json ./
COPY scripts/patch-upsetjs-venn.js scripts/
RUN npm ci --omit=dev && npm cache clean --force

RUN apk del .build-deps && rm -rf /var/cache/apk/* /tmp/*

COPY *.js ./
COPY lib/*.js lib/
COPY LICENSE .

EXPOSE 3400

ENTRYPOINT ["node", "--max-http-header-size=65536", "index.js"]

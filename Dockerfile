FROM node:22-alpine
ARG GAME=undercover
ENV GAME=$GAME NODE_ENV=production PORT=3000 DATA_DIR=/app/data
WORKDIR /app
COPY --chown=node:node package.json package-lock.json launcher.js ./
COPY --chown=node:node packages ./packages
COPY --chown=node:node apps ./apps
RUN npm ci --omit=dev --ignore-scripts && mkdir /app/data && chown node:node /app/data && if [ -f apps/$GAME/nginx.conf.sigil ]; then cp apps/$GAME/nginx.conf.sigil /app/nginx.conf.sigil; fi && if [ -f apps/$GAME/app.json ]; then cp apps/$GAME/app.json /app/app.json; fi
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","launcher.js"]

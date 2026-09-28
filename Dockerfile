# Etapa 1: build do frontend
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Etapa 2: nginx servindo o app e encaminhando /go2rtc para o go2rtc
FROM nginx:1.27-alpine
# Vai como modelo: o nginx gera conf.d/default.conf no boot, com a porta de BLIZZARD_WEB_LISTEN.
ENV BLIZZARD_WEB_LISTEN=80
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

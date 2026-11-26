FROM node:22-alpine

RUN apk add --no-cache tzdata

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/auth_info_baileys

EXPOSE 3000

CMD ["npm", "start"]

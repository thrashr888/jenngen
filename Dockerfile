FROM node:latest

ENV OPENAI_API_KEY={OPENAI_API_KEY}

WORKDIR /app

COPY package.json .
RUN npm install

COPY . .

RUN npx jenngen .

FROM nginx:latest
COPY --from=0 /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
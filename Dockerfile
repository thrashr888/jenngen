FROM node

ENV OPENAI_API_KEY={insert your OpenAI API key here}

COPY package.json .

COPY . /usr/share/nginx/html

RUN npx jenngen .

CMD ["nginx", "-g", "daemon off;"]

EXPOSE 80
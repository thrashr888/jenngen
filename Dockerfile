# Use a node image
FROM node:latest

# Pass the OPENAI_API_KEY environment variable from the docker runner
ARG OPENAI_API_KEY
ENV OPENAI_API_KEY=${OPENAI_API_KEY}

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy the package.json file
COPY package.json ./

# Install dependencies
RUN npm install

# Copy the generated website to the nginx folder
COPY . /usr/share/nginx/html

# Use `npx jenngen .` to generate the website
RUN npx jenngen .

# Install nginx to serve the website
RUN npm install -g nginx

# Expose the webserver on port 80
EXPOSE 80

# Run a webserver to serve the website
CMD ["nginx", "-g", "daemon off;"]
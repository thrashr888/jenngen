# Use a Node image
FROM node:latest

# Pass the OPENAI_API_KEY environment variable from the docker runner
ARG OPENAI_API_KEY
ENV OPENAI_API_KEY=${OPENAI_API_KEY}

# Set the working directory
WORKDIR /usr/src/app

# Copy the package.json file
COPY package.json ./

# Install dependencies
RUN npm install

# Copy the generated website source code
COPY . .

# Use `npx jenngen .` to generate the website
RUN npx jenngen .

# Use nginx to serve the website
FROM nginx:alpine

# Copy the built site to the nginx folder
COPY --from=0 /usr/src/app/build /usr/share/nginx/html

# Expose the webserver on port 80
EXPOSE 80

# Start nginx and serve the content
CMD ["nginx", "-g", "daemon off;"]
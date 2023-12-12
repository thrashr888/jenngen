# Use a Node.js official image
FROM node:latest

# Pass the OPENAI_API_KEY environment variable from the Docker runner
ARG OPENAI_API_KEY
ENV OPENAI_API_KEY $OPENAI_API_KEY

# Set the working directory
WORKDIR /usr/src/app

# Copy the package.json file
COPY package.json .

# Install dependencies
RUN npm install

# Copy the generated website source files to the working directory
COPY . .

# Use `npx jenngen .` to generate the website
RUN npx jenngen .

# Use nginx official image to serve the website
FROM nginx:alpine

# Copy the generated website from the previous stage to the nginx folder
COPY --from=0 /usr/src/app/dist /usr/share/nginx/html

# Expose the web server on port 80
EXPOSE 80

# Start Nginx and keep it running in the foreground
CMD ["nginx", "-g", "daemon off;"]
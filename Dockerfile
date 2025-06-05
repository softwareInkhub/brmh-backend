# Use Node.js LTS version
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Create a non-root user
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

# Create directory for swagger files
RUN mkdir -p swagger

# Copy application files
COPY swagger/ ./swagger/
COPY lib/ ./lib/
COPY aws-messaging-handlers.js ./
COPY aws-messaging.yaml ./
COPY executionHandler.js ./
COPY openapi.yaml ./
COPY pinterest-api.yaml ./
COPY pinterest-handlers.js ./
COPY README.md ./
COPY index.js ./

# Expose port
EXPOSE 5000

# Set environment variables
ENV NODE_ENV=development
ENV PORT=5000

# Start the application
CMD ["npm", "start"] 
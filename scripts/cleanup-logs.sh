#!/bin/bash

# PM2 Log Cleanup Script
# This script helps you manually clean up PM2 logs and system resources

echo "🧹 Starting comprehensive log cleanup..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    print_error "PM2 is not installed. Please install PM2 first."
    exit 1
fi

# Show current disk usage
print_status "Current disk usage:"
df -h

# Show current PM2 log sizes
print_status "Current PM2 log sizes:"
if [ -d "$HOME/.pm2/logs" ]; then
    find $HOME/.pm2/logs -name "*.log" -exec ls -lh {} \; 2>/dev/null || print_warning "No log files found"
    
    # Calculate total log size
    total_size=$(find $HOME/.pm2/logs -name "*.log" -exec du -ch {} + 2>/dev/null | tail -1 | awk '{print $1}')
    print_status "Total PM2 log size: $total_size"
else
    print_warning "PM2 logs directory not found"
fi

# Ask for confirmation
echo ""
print_warning "This will:"
echo "  1. Flush all PM2 logs"
echo "  2. Remove old PM2 log files"
echo "  3. Clean npm cache"
echo "  4. Clean system journal logs"
echo "  5. Clean temporary files"
echo ""
read -p "Do you want to continue? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_status "Operation cancelled."
    exit 0
fi

# Flush PM2 logs
print_status "Flushing PM2 logs..."
pm2 flush
print_success "PM2 logs flushed"

# Remove old log files
print_status "Removing old PM2 log files..."
if [ -d "$HOME/.pm2/logs" ]; then
    find $HOME/.pm2/logs -name "*.log" -type f -delete 2>/dev/null
    print_success "Old PM2 log files removed"
else
    print_warning "PM2 logs directory not found"
fi

# Clean npm cache
print_status "Cleaning npm cache..."
npm cache clean --force 2>/dev/null
print_success "npm cache cleaned"

# Clean system journal logs (requires sudo)
print_status "Cleaning system journal logs..."
sudo journalctl --vacuum-size=50M 2>/dev/null || print_warning "Could not clean journal logs (may require sudo)"
sudo journalctl --vacuum-time=7d 2>/dev/null || print_warning "Could not clean journal logs by time"

# Clean temporary files
print_status "Cleaning temporary files..."
if [ -d "/tmp" ]; then
    sudo find /tmp -type f -atime +7 -delete 2>/dev/null || print_warning "Could not clean some temp files"
fi

# Clean old compressed logs
print_status "Cleaning old compressed logs..."
find $HOME/.pm2/logs -name "*.gz" -mtime +7 -delete 2>/dev/null || print_warning "No old compressed logs found"

# Restart PM2 logs
print_status "Reloading PM2 logs..."
pm2 reloadLogs
print_success "PM2 logs reloaded"

# Show final disk usage
echo ""
print_success "Cleanup completed!"
print_status "Final disk usage:"
df -h

# Show new PM2 log sizes
print_status "New PM2 log sizes:"
if [ -d "$HOME/.pm2/logs" ]; then
    find $HOME/.pm2/logs -name "*.log" -exec ls -lh {} \; 2>/dev/null || print_status "No log files found (expected after cleanup)"
else
    print_status "PM2 logs directory will be recreated when logs are generated"
fi

# Show PM2 status
print_status "Current PM2 status:"
pm2 status

echo ""
print_success "Log cleanup completed successfully!"
print_status "Log rotation will keep future logs under control."

#!/bin/bash

# Cache Log Management Script
# This script helps manage excessive logging from the cache system

echo "🔧 Cache Log Management Script"
echo "=============================="

# Function to check log file size
check_log_size() {
    if [ -f "/var/log/pm2/brmh-backend-v2-out.log" ]; then
        size=$(du -h /var/log/pm2/brmh-backend-v2-out.log | cut -f1)
        echo "📊 Current log file size: $size"
    else
        echo "❌ Log file not found"
    fi
}

# Function to clear logs
clear_logs() {
    echo "🧹 Clearing PM2 logs..."
    pm2 flush
    echo "✅ Logs cleared"
}

# Function to restart with verbose logging
enable_verbose_logging() {
    echo "🔍 Enabling verbose logging..."
    export CACHE_LOG_VERBOSE=true
    pm2 restart brmh-backend-v2
    echo "✅ Verbose logging enabled"
}

# Function to restart with minimal logging
disable_verbose_logging() {
    echo "🔇 Disabling verbose logging..."
    export CACHE_LOG_VERBOSE=false
    pm2 restart brmh-backend-v2
    echo "✅ Verbose logging disabled"
}

# Function to monitor logs in real-time
monitor_logs() {
    echo "👀 Monitoring logs in real-time (Ctrl+C to stop)..."
    tail -f /var/log/pm2/brmh-backend-v2-out.log | grep -E "(🔒|🔓|📤|✅|❌|🔄|📦)"
}

# Main menu
case "$1" in
    "check")
        check_log_size
        ;;
    "clear")
        clear_logs
        ;;
    "verbose")
        enable_verbose_logging
        ;;
    "quiet")
        disable_verbose_logging
        ;;
    "monitor")
        monitor_logs
        ;;
    *)
        echo "Usage: $0 {check|clear|verbose|quiet|monitor}"
        echo ""
        echo "Commands:"
        echo "  check   - Check current log file size"
        echo "  clear   - Clear all PM2 logs"
        echo "  verbose - Enable verbose logging"
        echo "  quiet   - Disable verbose logging"
        echo "  monitor - Monitor logs in real-time"
        ;;
esac

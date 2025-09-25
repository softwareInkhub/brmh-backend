# Log Management Guide

This guide explains how the BRMH backend handles log management to prevent disk space issues and ensure optimal performance on your t2.medium instance.

## 🚨 Problem Solved

Previously, PM2 logs were growing to 2-3GB and causing deployment issues on t2.medium (8GB) instances. This has been resolved with:

1. **Automatic log rotation** limiting logs to 50MB max
2. **Comprehensive cleanup** during deployment
3. **Reduced log verbosity** in production
4. **Automated maintenance** via cron jobs

## 📋 Log Rotation Configuration

### PM2 Log Rotation

The deployment script automatically configures PM2 log rotation:

```javascript
// PM2 log rotation settings
pm2 set pm2-logrotate:max_size 50MB      // Maximum log file size
pm2 set pm2-logrotate:retain 5           // Keep 5 old log files
pm2 set pm2-logrotate:compress true      // Compress old logs
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'  // Rotate daily at midnight
```

### System Log Rotation

System-level logrotate configuration in `/etc/logrotate.d/pm2-ubuntu`:

```bash
/home/ubuntu/.pm2/logs/*.log {
    daily
    missingok
    rotate 7
    compress
    notifempty
    create 0640 ubuntu ubuntu
    size 50M
    postrotate
        pm2 reloadLogs
    endscript
}
```

## 🔧 Automated Cleanup

### During Deployment

The deployment script performs comprehensive cleanup:

1. **System cleanup**: removes temporary files, apt cache
2. **PM2 log flush**: clears current logs
3. **npm cache cleanup**: removes cached packages
4. **Journal log cleanup**: limits system logs to 50MB
5. **Old log removal**: deletes logs before rotation setup

### Scheduled Maintenance

Automated cron jobs for ongoing maintenance:

```bash
# Remove large log files (>50MB) daily at 2 AM
0 2 * * * /usr/bin/find /home/ubuntu/.pm2/logs -name '*.log' -size +50M -delete

# Flush PM2 logs daily at 3 AM
0 3 * * * /usr/bin/pm2 flush

# Clean npm cache weekly on Sunday at 4 AM
0 4 * * 0 /usr/bin/npm cache clean --force
```

## 📊 Monitoring Log Sizes

### Check Current Log Sizes

```bash
# Check PM2 log sizes
find ~/.pm2/logs -name "*.log" -exec ls -lh {} \;

# Check total PM2 log directory size
du -sh ~/.pm2/logs

# Check disk usage
df -h
```

### PM2 Commands

```bash
# View current log configuration
pm2 conf pm2-logrotate

# Flush all logs immediately
pm2 flush

# Reload logs (after rotation)
pm2 reloadLogs

# Check PM2 status
pm2 status
```

## 🛠️ Manual Cleanup

### Quick Cleanup Script

Use the provided cleanup script:

```bash
cd /home/ubuntu/brmh-backend
./scripts/cleanup-logs.sh
```

### Manual Commands

```bash
# Flush PM2 logs
pm2 flush

# Remove old log files
rm -rf ~/.pm2/logs/*.log

# Clean npm cache
npm cache clean --force

# Clean system logs (requires sudo)
sudo journalctl --vacuum-size=50M
```

## 🔍 Optimized Logging

### Production Log Levels

The application uses reduced logging in production:

```javascript
// Only log important events in production
if (process.env.NODE_ENV !== 'production') {
  console.log("Debug information");
}

// Reduced verbosity for repetitive operations
if (chunkIndex % 10 === 0 || chunkIndex < 3) {
  console.log(`Processing chunk ${chunkIndex}`);
}
```

### Environment Variables

Set these in your `.env` for production:

```bash
NODE_ENV=production
LOG_LEVEL=error
DEBUG=false
```

## 📈 Performance Impact

### Before Optimization
- Log files: 2-3GB
- Disk usage: Critical on 8GB instance
- Deployment failures: Common
- Performance: Degraded

### After Optimization
- Log files: <50MB each
- Disk usage: Controlled
- Deployment failures: Eliminated
- Performance: Optimized

## 🚨 Troubleshooting

### If Logs Still Grow Large

1. Check if log rotation is working:
   ```bash
   pm2 conf pm2-logrotate
   ```

2. Manually trigger rotation:
   ```bash
   pm2 install pm2-logrotate
   pm2 set pm2-logrotate:max_size 50MB
   ```

3. Check cron jobs:
   ```bash
   crontab -l
   ```

### If Deployment Fails

1. Free up space manually:
   ```bash
   ./scripts/cleanup-logs.sh
   ```

2. Check disk space:
   ```bash
   df -h
   ```

3. Remove large files:
   ```bash
   find /home/ubuntu -size +100M -type f -ls
   ```

## 📝 Log File Locations

```
/home/ubuntu/.pm2/logs/
├── brmh-backend-v2-error.log    # Error logs
├── brmh-backend-v2-out.log      # Output logs  
├── brmh-backend-v2.log          # Combined logs
└── *.gz                         # Compressed old logs
```

## ⚙️ Configuration Files

- **Ecosystem config**: `ecosystem.config.js`
- **Log rotation**: `/etc/logrotate.d/pm2-ubuntu`
- **Cron jobs**: `crontab -l`
- **PM2 config**: `~/.pm2/module_conf.json`

## 🎯 Best Practices

1. **Monitor regularly**: Check log sizes weekly
2. **Use log rotation**: Always enable for production
3. **Set appropriate levels**: Use error/warn in production
4. **Clean before deploy**: Always run cleanup in CI/CD
5. **Monitor disk space**: Set up alerts for 80% usage
6. **Use structured logging**: Avoid excessive debug output
7. **Rotate frequently**: Daily or when size limits reached

## 📞 Emergency Recovery

If your instance runs out of space:

```bash
# Emergency cleanup (run as ubuntu user)
sudo rm -rf /tmp/*
sudo apt-get clean
pm2 flush
rm -rf ~/.pm2/logs/*
npm cache clean --force
sudo journalctl --vacuum-size=10M

# Then redeploy
git pull origin main
npm install --production
pm2 restart all
```

This log management system ensures your t2.medium instance stays healthy and deployments succeed consistently.

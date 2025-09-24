module.exports = {
  apps: [{
    name: 'brmh-backend-v2',
    script: 'npm',
    args: 'start',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '2G',
    env: {
      NODE_ENV: 'production',
      PORT: 5001
    },
    // Log configuration
    log_file: '/home/ubuntu/.pm2/logs/brmh-backend-v2.log',
    out_file: '/home/ubuntu/.pm2/logs/brmh-backend-v2-out.log',
    error_file: '/home/ubuntu/.pm2/logs/brmh-backend-v2-error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // Performance settings
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 4000,
    
    // Advanced settings
    kill_timeout: 5000,
    listen_timeout: 3000,
    
    // Health check
    health_check_grace_period: 3000
  }]
};

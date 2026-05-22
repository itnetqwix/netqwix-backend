/**
 * PM2 cluster on a single server — uses all CPU cores without extra VMs.
 *
 * Requirements when instances > 1:
 *   REDIS_ENABLED=true  (Socket.IO adapter + shared lesson timer state)
 *
 * Start:
 *   pm2 start ecosystem.config.js --env production
 *   pm2 reload ecosystem.config.js --env production --update-env
 */
module.exports = {
  apps: [
    {
      name: process.env.PM2_APP_NAME || "netqwix-api-prod",
      script: "dist/src/index.js",
      cwd: __dirname,
      instances: process.env.PM2_INSTANCES || "2",
      exec_mode: "cluster",
      listen_timeout: 10000,
      kill_timeout: 8000,
      max_memory_restart: "1200M",
      env: {
        NODE_ENV: "development",
        PM2_INSTANCES: "1",
      },
      env_staging: {
        NODE_ENV: "production",
        PM2_INSTANCES: "1",
        REDIS_ENABLED: "true",
      },
      env_production: {
        NODE_ENV: "production",
        PM2_INSTANCES: "2",
        REDIS_ENABLED: "true",
      },
    },
  ],
};

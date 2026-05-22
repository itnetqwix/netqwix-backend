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
      name: "netqwix-api",
      script: "dist/src/index.js",
      cwd: __dirname,
      instances: process.env.PM2_INSTANCES || "max",
      exec_mode: "cluster",
      listen_timeout: 10000,
      kill_timeout: 8000,
      max_memory_restart: "1200M",
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};

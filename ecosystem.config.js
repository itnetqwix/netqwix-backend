/**
 * PM2 on a single server.
 *
 * Socket.IO + HTTP long-polling: use PM2_INSTANCES=1 unless you add sticky
 * sessions (@socket.io/sticky or nginx ip_hash). Redis adapter broadcasts events
 * across workers but does NOT route polling sessions — "Session ID unknown" otherwise.
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
      instances: process.env.PM2_INSTANCES || "1",
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
        PM2_INSTANCES: "1",
        REDIS_ENABLED: "true",
      },
    },
  ],
};

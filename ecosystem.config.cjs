module.exports = {
  apps: [
    {
      name: 'house-of-muktai-incentives',
      script: 'node_modules/.bin/tsx',
      args: 'server.ts',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '450M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        APP_URL: 'https://houseofmuktai.co.in',
        ALLOWED_ORIGINS:
          'https://houseofmuktai.co.in,https://www.houseofmuktai.co.in,https://staff.houseofmuktai.co.in',
      },
    },
  ],
};

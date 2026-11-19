require('dotenv').config({ path: '/var/www/genlatex/.env' });

module.exports = {
  apps: [
    {
      name: "genlatex",
      cwd: "/var/www/genlatex",
      script: "node",
      args: "node_modules/next/dist/bin/next start -p 3000",
      env: {
        NODE_ENV: "production",
        ...process.env
      }
    }
  ]
};
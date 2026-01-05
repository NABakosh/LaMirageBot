module.exports = {
  apps: [{
    name: "la-mirage-bot",
    script: "./main.js", // или ваш главный файл
  }],
  deploy: {
    production: {
      user: "your-user",
      host: "your-server-ip",
      ref: "origin/main",
      repo: "https://github.com/NABakosh/LaMirageBot.git",
      path: "/var/www/la-mirage",
      "post-deploy": "npm install && pm2 reload ecosystem.config.js"
    }
  }
};
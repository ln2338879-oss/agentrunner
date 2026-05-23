module.exports = {
  apps: [
    {
      name: "agentrunner",
      script: "src/index.ts",
      interpreter: "bun",
      cwd: "/opt/agentrunner",
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      max_restarts: 20,
      restart_delay: 10000,
      watch: false,
      time: true,
      out_file: "/var/log/agentrunner/out.log",
      error_file: "/var/log/agentrunner/error.log",
    },
  ],
};

/**
 * pm2 process definition. The backend listens on 127.0.0.1:4100 — nginx is the only
 * thing that talks to it, so it is never exposed directly. 4100 rather than 4000 to
 * leave the other app on this box alone.
 */
module.exports = {
  apps: [
    {
      name: 'shreeram-backend',
      cwd: '/home/ec2-user/shreeram/server',
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      // 911MB box shared with another app — a leak should restart, not swap the host to death.
      max_memory_restart: '300M',
      env: { NODE_ENV: 'production' },
      error_file: '/home/ec2-user/logs/shreeram-error.log',
      out_file: '/home/ec2-user/logs/shreeram-out.log',
      time: true,
    },
  ],
};

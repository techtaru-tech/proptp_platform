/**
 * pm2 process definition. The backend listens on 127.0.0.1:4300 — nginx is the only
 * thing that talks to it, so it is never exposed directly. 4300 rather than 4000 because
 * this box already runs taskflow and the ShreeRam platform on their own ports.
 */
module.exports = {
  apps: [
    {
      name: 'rosium-backend',
      cwd: '/home/ec2-user/rosium/server',
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      // 911MB box shared with two other apps — a leak should restart this process rather
      // than swap the host to death and take the neighbours with it.
      max_memory_restart: '250M',
      env: { NODE_ENV: 'production' },
      error_file: '/home/ec2-user/logs/rosium-error.log',
      out_file: '/home/ec2-user/logs/rosium-out.log',
      time: true,
    },
  ],
};

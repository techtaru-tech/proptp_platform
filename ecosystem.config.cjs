/**
 * pm2 process definition. The backend listens on 127.0.0.1:4700 — nginx is the only thing that
 * talks to it, so it is never exposed directly. 4700 because this box already runs other apps
 * on 4100, 4300, 4400, 4500 and 4600.
 */
module.exports = {
  apps: [
    {
      name: 'propto-crm-backend',
      cwd: '/home/ec2-user/propto-crm/server',
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      // A ~900MB box shared with several apps — a leak should restart this process rather than
      // swap the host to death and take the neighbours with it.
      max_memory_restart: '250M',
      env: { NODE_ENV: 'production' },
      error_file: '/home/ec2-user/logs/propto-crm-error.log',
      out_file: '/home/ec2-user/logs/propto-crm-out.log',
      time: true,
    },
  ],
};

@echo off
set SESSION_SECRET=test-secret-key-12345678901234567890
set NODE_ENV=production
node server.js > server_output.log 2>&1
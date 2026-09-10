#!/bin/bash

echo "🔧 تهيئة Hostinger VPS للمرة الأولى..."

# تحديث النظام
echo "📦 تحديث النظام..."
sudo apt update && sudo apt upgrade -y

# تثبيت Node.js 18
echo "🟢 تثبيت Node.js 18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# تثبيت PM2
echo "⚡ تثبيت PM2..."
sudo npm install -g pm2

# تثبيت Nginx
echo "🌐 تثبيت Nginx..."
sudo apt install -y nginx

# إعداد Nginx
echo "⚙️ إعداد Nginx..."
sudo rm /etc/nginx/sites-enabled/default
sudo cp nginx.conf /etc/nginx/sites-available/workshop
sudo ln -s /etc/nginx/sites-available/workshop /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# تشغيل السيرفر
echo "🚀 تشغيل السيرفر..."
pm2 start ecosystem.config.js
pm2 save
pm2 startup

echo "✅ تم التهيئة بنجاح!"
echo "📝 الخطوات التالية:"
echo "1. عدّل DNS الدومين للإشاره إلى IP السيرفر"
echo "2. عدّل 'your-domain.com' في nginx.conf"
echo "3. شغّل: sudo certbot --nginx -d your-domain.com -d www.your-domain.com"

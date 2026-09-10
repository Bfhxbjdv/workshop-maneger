#!/bin/bash

echo "🚀 بدء النشر على Hostinger..."

REPO_URL="https://github.com/your-username/your-repo.git"
DEPLOY_DIR="/home/$USER/workshop-manager"

echo "📥 جلب أحدث الكود..."
cd $DEPLOY_DIR
git pull origin main

echo "📦 تثبيت المكتبات..."
npm install --production

echo "📁 إنشاء المجلدات..."
mkdir -p logs data Server_Storage backups

echo "🔄 إعادة تشغيل السيرفر..."
pm2 restart workshop-manager || pm2 start ecosystem.config.js

echo "💾 حفظ الإعدادات..."
pm2 save

echo "✅ تم النشر بنجاح!"
echo "🌐 الموقع يعمل على: http://your-domain.com"

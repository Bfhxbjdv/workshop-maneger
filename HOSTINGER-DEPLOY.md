# 📋 دليل النشر على Hostinger VPS

## الخطوة 1: شراء VPS من Hostinger
- ادخل على hostinger.com
- اختر **VPS Hosting** → **KVM 2** (أو أعلى)
- اختر نظام **Ubuntu 22.04**
- ستحصل على: **IP** و **كلمة مرور SSH**

## الخطوة 2: الاتصال بالسيرفر
```bash
ssh root@YOUR_SERVER_IP
```

## الخطوة 3: تهيئة السيرفر
```bash
# نسخ ملفات المشروع
scp -r ./workshop-manager root@YOUR_SERVER_IP:/root/

# الدخول للسيرفر
ssh root@YOUR_SERVER_IP

# تشغيل التهيئة
cd workshop-manager
chmod +x setup-hostinger.sh
./setup-hostinger.sh
```

## الخطوة 4: إعداد الدومين
1. ادخل على لوحة تحكم DNS للدومين
2. أضف سجل A:
   - **Name:** @
   - **Value:** IP السيرفر
3. انتظر 5-10 دقائق للتحديث

## الخطوة 5: تفعيل SSL (HTTPS)
```bash
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

## الخطوة 6: رفع الكود
```bash
# من جهازك المحلي
git add .
git commit -m "部署到 Hostinger"
git push origin main

# على السيرفر
cd /root/workshop-manager
./deploy.sh
```

## أوامر مفيدة
```bash
# عرض حالة السيرفر
pm2 status

# عرض السجلات
pm2 logs workshop-manager

# إعادة تشغيل
pm2 restart workshop-manager

# إيقاف
pm2 stop workshop-manager
```

## معالجة الأخطاء
| المشكلة | الحل |
|---------|------|
| السيرفر لا يعمل | `pm2 restart workshop-manager` |
| خطأ 502 | تأكد من أن السيرفر يعمل: `pm2 status` |
| SSL لا يعمل | أعد تشغيل: `sudo certbot --nginx` |
| الملفات لا تُرفع | تحقق من صلاحيات مجلد uploads |

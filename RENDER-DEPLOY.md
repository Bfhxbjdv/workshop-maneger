# دليل النشر على Render.com

## الخطوة 1: رفع المشروع على GitHub

### 1.1 افتح GitHub Desktop:
1. **File** → **Add existing repository**
2. اختر مجلد المشروع: `C:\Users\HP\Desktop\ موقع لتنظيم المهام على الشبكة`
3. اضغط **Add repository**

### 1.2 انشر على GitHub:
1. اضغط **"Publish repository"** (أزرق في الأعلى)
2. اكتب اسم المستودع: `workshop-manager`
3. اجعله **Private** (خاص)
4. اضغط **"Publish repository"**

---

## الخطوة 2: إنشاء حساب على Render.com

1. افتح: **https://render.com**
2. اضغط **"Get Started"**
3. سجّل الدخول بحساب **Google** أو **GitHub**
4. اختر **GitHub** كمصدر

---

## الخطوة 3: إنشاء تطبيق جديد

1. اضغط **"New +"** → **"Web Service"**
2. اختر مستودع `workshop-manager`
3. اضغط **"Connect"**

---

## الخطوة 4: إعدادات النشر

املأ الحقول كالتالي:

| الحقل | القيمة |
|-------|--------|
| **Name** | `workshop-manager` |
| **Region** | `Frankfurt (EU)` أو أقرب منطقة |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `node server.js` |
| **Instance Type** | `Free` |

---

## الخطوة 5: متغيرات البيئة

اضغط **"Advanced"** ثم أضف:

| المفتاح | القيمة |
|---------|--------|
| `NODE_VERSION` | `18` |
| `SESSION_SECRET` | `workshop-secret-2024-production` |

---

## الخطوة 6: ارفع الكود

1. اضغط **"Create Web Service"**
2. سيركب السيرفر تلقائياً (2-3 دقائق)
3. ستحصل على رابط مثل: `https://workshop-manager-xxxx.onrender.com`

---

## الخطوة 7: إضافة الدومين

### 7.1 على Render.com:
1. اذهب لـ **Settings** في التطبيق
2. اضغط **"Custom Domains"**
3. اكتب دومينك (مثال: `kazanji-group.com`)
4. اضغط **"Save"**
5. ستحصل على **CNAME** مثل: `workshop-manager-xxxx.onrender.com`

### 7.2 على Hostinger (DNS):
1. اذهب لـ **hPanel** → **DNS Zone Editor**
2. أضف سجل:

| Type | Name | Value |
|------|------|-------|
| `CNAME` | `@` | `workshop-manager-xxxx.onrender.com` |
| `CNAME` | `www` | `workshop-manager-xxxx.onrender.com` |

### 7.3 انتظر 5-10 دقائق للتحديث

---

## ملاحظات مهمة

### ⚠️ الخطة المجانية:
- **تنام** بعد 15 دقيقة بدون زوار (تستيقظ تلقائياً عند الدخول)
- **البيانات تُحذف** عند إعادة التشغيل (يُفضل نسخ احتياطي)
- **512 MB RAM** كافية لموقعك

### ✅ نسخ احتياطي:
- من لوحة التحكم `/admin` → النسخ الاحتياطي
- الملفات تُرفع إلى Google Drive تلقائياً

### 🔄 تحديث الكود:
- عند تعديل الكود، اضغط **"Manual Deploy"** على Render
- أو ارفع على GitHub وسيتم النشر تلقائياً

---

## بيانات الدخول بعد النشر:

| المستخدم | اسم المستخدم | كلمة المرور |
|----------|-------------|-------------|
| مدير | `admin` | `admin123` |
| مصمم | `designer` | `designer123` |
| ليزر | `laser` | `laser123` |
| راوتر | `router` | `router123` |

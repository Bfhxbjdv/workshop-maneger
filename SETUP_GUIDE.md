# دليل ربط Google Drive ورفع الموقع على الإنترنت

## أولاً: ربط Google Drive (تخزين الملفات)

### الخطوة 1: إنشاء مشروع في Google Cloud
1. افتح https://console.cloud.google.com
2. سجل الدخول بحساب Google الخاص بك
3. اضغط على **Select Project** ← **New Project**
4. سمّه (مثلاً: `workshop-manager`) ← **Create**

### الخطوة 2: تفعيل Google Drive API
1. في المشروع الجديد، اذهب إلى **APIs & Services** ← **Library**
2. ابحث عن **Google Drive API** ← اضغط **Enable**

### الخطوة 3: إنشاء Service Account (حساب خدمة)
1. اذهب إلى **APIs & Services** ← **Credentials**
2. اضغط **Create Credentials** ← **Service Account**
3. سمّه (مثلاً: `workshop-storage`) ← **Create and Continue**
4. في الخطوة التالية، اتركها فارغة ← **Done**
5. اضغط على اسم الحساب الجديد
6. اذهب إلى **Keys** ← **Add Key** ← **Create New Key**
7. اختر **JSON** ← **Create** ← سيتم تحميل ملف JSON تلقائياً

### الخطوة 4: مشاركة مجلد Google Drive مع الخدمة
1. افتح Google Drive: https://drive.google.com
2. أنشئ مجلداً جديداً (مثلاً: `Workshop_Files`)
3. افتح المجلد، اضغط على اسمه ← **Share**
4. اكتب البريد الإلكتروني لحساب الخدمة (موجود في ملف JSON: `client_email`)
5. أعطه صلاحية **Editor** ← **Share**

### الخطوة 5: الحصول على معرف المجلد (Folder ID)
1. افتح المجلد في المتصفح
2. الرابط سيكون مثل: `https://drive.google.com/drive/folders/1ABCxyz123...`
3. انسخ الجزء بعد `/folders/` (مثل `1ABCxyz123...`)

### الخطوة 6: إضافة المفاتيح إلى المشروع
انسخ ملف JSON الذي تم تحميله إلى مجلد المشروع وسمّه `service-account-key.json`،
ثم عدّل ملف `.env`:
```
GOOGLE_DRIVE_KEY_PATH=./service-account-key.json
GOOGLE_DRIVE_FOLDER_ID=1ABCxyz123...
```

---

## ثانياً: رفع الموقع على الإنترنت (مجاناً)

### الخيار المقترح: Render.com (مجاني وسهل)

#### 1. إنشاء حساب في Render
- افتح https://render.com
- سجل باستخدام حساب GitHub

#### 2. رفع الكود إلى GitHub
1. أنشئ حساب على https://github.com (إن لم يكن لديك)
2. أنشئ مستودعاً جديداً (Repository)
3. شغّل الأوامر التالية:
```bash
cd "C:\Users\HP\Desktop\موقع لتنظيم المهام على الشبكة"
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/yourusername/workshop-manager.git
git branch -M main
git push -u origin main
```

#### 3. إنشاء PostgreSQL مجاني
1. في Render Dashboard: **New** ← **PostgreSQL**
2. اختر **Free** plan
3. بعد الإنشاء، انسخ **Internal Database URL**

#### 4. نشر التطبيق (Web Service)
1. في Render Dashboard: **New** ← **Web Service**
2. اختر المستودع من GitHub
3. الإعدادات:
   - **Name**: `workshop-manager`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: **Free**

#### 5. إضافة متغيرات البيئة (Environment Variables)
في Render, اذهب إلى **Environment** وأضف:
```
PORT=3000
SESSION_SECRET=your-secret-key
GOOGLE_DRIVE_KEY_JSON={"type":"service_account",...}  <-- محتوى ملف JSON كاملاً (بدون مسافات)
GOOGLE_DRIVE_FOLDER_ID=1ABCxyz123...
NODE_VERSION=18
```

#### 6. نشر الموقع
اضغط **Deploy** ← انتظر 5-10 دقائق

رابط موقعك سيكون: `https://workshop-manager.onrender.com`

---

### خيارات استضافة مجانية أخرى
| المنصة | المميزات | العيوب |
|--------|---------|--------|
| **Render.com** | PostgreSQL مجاني، SSL مجاني، سهل | التطبيق ينام بعد 15 دقيقة خمول |
| **Railway.app** | 5$ رصيد مجاني شهرياً، PostgreSQL | قد ينفد الرصيد مع الاستخدام |
| **Fly.io** | 3 تطبيقات مجانية، PostgreSQL | إعدادات أكثر تعقيداً |

> *نصيحة: في Render، التطبيق "ينام" بعد 15 دقيقة خمول - أول زيارة بعد الخمول تأخذ 30-60 ثانية لتعود للحياة.*

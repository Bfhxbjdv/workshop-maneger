require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const TOKEN_PATH = path.join(__dirname, '..', 'tokens.json');

const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('تأكد من وجود GOOGLE_DRIVE_CLIENT_ID و GOOGLE_DRIVE_CLIENT_SECRET في ملف .env');
  process.exit(1);
}

const oauth = new google.auth.OAuth2(clientId, clientSecret, 'urn:ietf:wg:oauth:2.0:oob');
const authUrl = oauth.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });

console.log('\n══════════════════════════════════════════════════');
console.log('  ربط Google Drive بحسابك الشخصي');
console.log('══════════════════════════════════════════════════\n');
console.log('الخطوة 1: افتح الرابط التالي في المتصفح:');
console.log('──────────────────────────────────────────────────');
console.log(authUrl);
console.log('──────────────────────────────────────────────────\n');
console.log('الخطوة 2: سجل الدخول بحساب Google الذي تملك فيه المجلد');
console.log('الخطوة 3: اضغط "Allow" للسماح بالصلاحيات');
console.log('الخطوة 4: انسخ الكود الذي يظهر (مثل: 4/0AX...)\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('الصق الكود هنا: ', async (code) => {
  try {
    const { tokens } = await oauth.getToken(code.trim());
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log('\n✅ تم حفظ التوكن بنجاح!');
    console.log('📁 الملف: tokens.json');
    console.log('🟢 Google Drive جاهز للاستخدام.\n');
  } catch (e) {
    console.error('\n❌ خطأ:', e.message);
  }
  rl.close();
});

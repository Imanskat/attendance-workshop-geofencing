# سیستم حضور و غیاب کارگاه (Geofencing)

## نسخه فعال: Cloudflare Pages + D1

🔗 **لینک سیستم**: https://attendance-workshop.pages.dev/
🔗 **پنل مدیر**: https://attendance-workshop.pages.dev/admin.html (یوزرنیم/پسورد ادمین جداگانه و خارج از این مخزن عمومی در اختیار شما قرار گرفته است)

لینک‌های کوتاه‌تر روی GitHub Pages هم در دسترس‌اند (فقط ریدایرکت به آدرس بالا):
🔗 https://imanskat.github.io/attendance-workshop-geofencing/
🔗 https://imanskat.github.io/attendance-workshop-geofencing/admin.html

**چرا از Google Apps Script به Cloudflare منتقل شد؟** نسخه اول روی Google Apps Script ساخته شده بود، اما `script.google.com` در ایران بدون VPN در دسترس نیست — یعنی کارمندان عملاً نمی‌توانستند check-in/check-out بزنند. به همین دلیل بک‌اند به Cloudflare Pages + Pages Functions + D1 (دیتابیس SQLite در edge) منتقل شد که معمولاً بدون فیلترشکن از ایران در دسترس است.

### ساختار پروژه جدید (پوشه `web/`)

| فایل | نقش |
|---|---|
| `web/functions/api.js` | بک‌اند: همه‌ی منطق (ورود، check-in/check-out، Geofence، ضدتقلب GPS، پنل مدیر) |
| `web/public/index.html` | صفحه کارمند (PWA ورود + ثبت حضور) |
| `web/public/admin.html` | پنل مدیر |
| `web/schema.sql` | ساخت جدول‌های D1 + داده نمونه |
| `wrangler.toml` | تنظیمات پروژه Cloudflare Pages + binding دیتابیس D1 |

### توسعه/دیپلوی مجدد

```bash
npx wrangler login
npx wrangler d1 execute attendance-workshop-db --remote --file=web/schema.sql   # فقط در صورت تغییر schema
npx wrangler pages deploy web/public --project-name=attendance-workshop
```

برای ست‌کردن/تغییر secret توکن ادمین:
```bash
npx wrangler pages secret put ADMIN_TOKEN_SECRET --project-name=attendance-workshop
```

---

## نسخه قدیمی (مرجع): Google Apps Script + Google Sheets

> ⚠️ این نسخه دیگر بک‌اند فعال سیستم نیست (به دلیل فیلترینگ `script.google.com` در ایران) و فقط برای مرجع/سناریوهای دیگر (مثلاً استفاده خارج از ایران بدون نیاز به هزینه هاست) نگه داشته شده. کد آن در `src/` باقی است.

بک‌اند و دیتابیس کاملاً روی Google Apps Script + Google Sheets ساخته شده — بدون سرور و بدون هزینه میزبانی.

## Google Sheet آماده‌شده

این Google Sheet به‌عنوان دیتابیس پروژه ساخته شده است (هنوز خالی — شیت‌ها با اجرای `initializeSheets` در مرحله بعد ساخته می‌شوند):

🔗 https://docs.google.com/spreadsheets/d/1chUzRL05RJOTvLw4f6hgoX8ePBo6PXXcj09zCKlmB1k/edit

> **چرا کد را خودم داخلش قرار ندادم؟** اتصال کد Apps Script به یک Sheet و دیپلوی به‌عنوان Web App نیاز به ورود با حساب گوگل شخصی شما دارد (تأیید OAuth از طریق مرورگر) — این مرحله از نظر امنیتی فقط باید توسط خود شما انجام شود و هیچ ابزاری برای دور زدن آن در اختیار من نیست. مراحل زیر کمتر از ۵ دقیقه طول می‌کشد.

## ساختار فایل‌ها (پوشه `src/`)

| فایل | نقش |
|---|---|
| `Code.gs` | منطق اصلی: doGet/doPost، ورود، چک‌این/چک‌اوت، فرمول هاورساین، اعتبارسنجی |
| `Admin.gs` | گزارش روزانه و خروجی CSV برای داشبورد مدیریت |
| `Seed.gs` | داده‌های نمونه برای تست |
| `Index.html` | صفحه اصلی PWA کارمندان (ورود + ثبت حضور) |
| `Admin.html` | داشبورد مدیریت |
| `Stylesheet.html` / `JavaScript.html` | استایل و منطق سمت کلاینت صفحه اصلی |
| `appsscript.json` | مانیفست پروژه |

## راه‌اندازی (دو روش)

### روش ۱: کپی دستی (بدون نیاز به نصب ابزار) — توصیه‌شده

کد دیگر به "bound script" (اسکریپت متصل به شیت) نیاز ندارد — `Code.gs` با `SPREADSHEET_ID` مستقیماً به Sheet وصل می‌شود. پس می‌توانید یک پروژه Apps Script مستقل (standalone) هم بسازید:

۱. به [script.google.com](https://script.google.com) بروید و **New project** بزنید (یا همان پروژه‌ای که الان باز کرده‌اید را استفاده کنید).
۲. برای هر فایل داخل `src/` یک فایل هم‌نام در ادیتور بسازید (`.gs` → Script، `.html` → HTML) و محتوا را کپی کنید. فایل پیش‌فرض `Code.gs` (با `myFunction` خالی) را با محتوای واقعی `src/Code.gs` جایگزین کنید.
۳. در `Code.gs` مقدار `SPREADSHEET_ID` از قبل روی شناسه Sheet ساخته‌شده تنظیم شده (`1chUzRL05RJOTvLw4f6hgoX8ePBo6PXXcj09zCKlmB1k`) — اگر Sheet دیگری ساختید، این مقدار را با شناسه آن (بخش بین `/d/` و `/edit` در آدرس) جایگزین کنید.
۴. در نوار بالا تابع `initializeSheets` را از منوی کشویی توابع انتخاب و **Run** بزنید (شیت‌های لازم داخل Google Sheet ساخته می‌شوند؛ اولین بار دسترسی‌ها را تأیید کنید).
۵. (اختیاری برای تست) تابع `seedSampleData` را هم اجرا کنید.
۶. از منوی **Deploy → New deployment** نوع **Web app** را انتخاب کنید:
   - Execute as: **Me**
   - Who has access: **Anyone** (یا طبق نیاز سازمان محدودتر کنید)
۷. آدرس Web App را دریافت و باز کنید.

### روش ۲: با `clasp` (برای توسعه‌دهندگان)
```bash
npm install -g @google/clasp
clasp login
cd src
cp .clasp.json.example .clasp.json   # و Script ID را داخلش بگذارید
clasp push
clasp deploy
```

## مدل داده (شیت‌ها)

**Workshops**: `id, name, lat, lng, radius`
**Employees**: `id, full_name, employee_code, pin, assigned_workshop_id`
**AttendanceRecords**: `id, employee_id, type, timestamp, lat, lng, accuracy, device_info, distance_m, status`
**Admins**: `id, username, password_hash, created_at` — با اجرای `initializeSheets`، اگر این شیت خالی باشد یک حساب پیش‌فرض ساخته می‌شود (مقدار پسورد در `Code.gs` تابع `ensureDefaultAdmin_` قابل تغییر است). **حتماً پسورد پیش‌فرض را بعد از اولین ورود تغییر دهید** (یک سطر در شیت `Admins` ویرایش کنید و مقدار `password_hash` را با خروجی `hashPassword_('پسورد-جدید')` جای‌گزین کنید).

برای افزودن کارگاه یا کارمند جدید، فقط یک سطر به شیت مربوطه اضافه کنید — نیازی به تغییر کد نیست.

## API ها (روی همان آدرس Web App با پارامتر `action`)

| متد | Action | توضیح |
|---|---|---|
| POST | `login` | ورود با `employee_code` + `pin` |
| POST | `check-in` | ثبت ورود: `employee_id, lat, lng, accuracy, device_info` |
| POST | `check-out` | ثبت خروج (همان بدنه `check-in`) |
| GET | `history&employeeId=` | تاریخچه حضور یک کارمند |
| GET | `last-status&employeeId=` | آخرین وضعیت (داخل/خارج از شیفت) |
| GET | `workshops` | لیست کارگاه‌ها |
| GET | `admin-dashboard` | صفحه داشبورد مدیریت (فرم ورود + گزارش) |
| POST | `admin-login` | ورود مدیر با `username` + `password`؛ خروجی یک `token` موقت (۶ ساعت اعتبار) |
| GET | `admin-summary&date=YYYY-MM-DD&token=` | خلاصه روزانه حضور و غیاب — نیاز به توکن معتبر |
| GET | `admin-export-csv&date=YYYY-MM-DD&token=` | خروجی CSV — نیاز به توکن معتبر |

## منطق امنیتی پیاده‌سازی‌شده

- **محدوده جغرافیایی (Geofence)**: فاصله با فرمول Haversine محاسبه و با `radius` کارگاه مقایسه می‌شود.
- **آستانه دقت GPS**: دقت بدتر از ۱۰۰ متر رد می‌شود (`ACCURACY_THRESHOLD_METERS` در `Code.gs`).
- **جلوگیری از ثبت دوبل**: کارمند تا وقتی check-out نزده نمی‌تواند دوباره check-in بزند و برعکس؛ همچنین فاصله حداقل ۶۰ ثانیه بین دو ثبت.
- **تشخیص پایه فیک GPS**: اگر سرعت ضمنی بین دو موقعیت متوالی از ۲۵۰ کیلومتر بر ساعت بیشتر باشد، ثبت رد می‌شود.
- همه رکوردهای رد‌شده هم (با `status` مربوطه) برای بررسی بعدی ذخیره می‌شوند، نه فقط رکوردهای موفق.

## محدودیت‌های شناخته‌شده

- تشخیص فیک GPS واقعی (مثل اپ‌های Mock Location) از سمت مرورگر/سرور به‌طور قطعی ممکن نیست؛ راهکار فعلی فقط یک هیورستیک پایه است.
- `Who has access: Anyone` یعنی هرکسی با لینک می‌تواند درخواست بزند؛ احراز هویت کارمندان با کد پرسنلی/پین و پنل مدیر با یوزرنیم/پسورد + توکن موقت، محافظت سطح پایه است، نه امنیت enterprise. برای محیط حساس‌تر، محدود کردن دسترسی Web App به دامنه سازمانی (Google Workspace) توصیه می‌شود.
- توکن پنل مدیر در `CacheService` نگه‌داری می‌شود (نه در شیت)، پس با ری‌استارت کوتای Apps Script یا گذشت ۶ ساعت منقضی می‌شود و باید دوباره وارد شوید.

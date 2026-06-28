CREATE TABLE IF NOT EXISTS workshops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  radius REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  employee_code TEXT NOT NULL UNIQUE,
  pin TEXT NOT NULL,
  assigned_workshop_id TEXT
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  lat REAL,
  lng REAL,
  accuracy REAL,
  device_info TEXT,
  distance_m REAL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- داده نمونه برای تست (همان داده‌های Seed.gs فعلی)
INSERT OR IGNORE INTO workshops (id, name, lat, lng, radius)
VALUES ('1', 'کارگاه مرکزی', 35.6892, 51.3890, 150);

INSERT OR IGNORE INTO employees (id, full_name, employee_code, pin, assigned_workshop_id)
VALUES
  ('1', 'علی رضایی', '1001', '1234', '1'),
  ('2', 'سارا محمدی', '1002', '5678', '1');

-- توجه: عمداً هیچ ادمین پیش‌فرضی اینجا seed نمی‌شود (چون این فایل در ریپازیتوری Public قرار دارد
-- و هر هش پسورد ثابتی قابل کرک با رینبو تیبل است). برای ساخت اولین ادمین، این دستور را با پسورد
-- دلخواه خودتان (و هش SHA-256 آن) مستقیماً روی دیتابیس remote اجرا کنید:
--
--   INSERT INTO admins (id, username, password_hash, created_at)
--   VALUES ('<uuid>', 'admin', '<sha256-hex-of-your-password>', '<iso-timestamp>');

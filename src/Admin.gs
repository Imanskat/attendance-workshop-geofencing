/**
 * توابع مخصوص داشبورد مدیریت: گزارش روزانه و خروجی CSV
 * این توابع به doGet اصلی اضافه می‌شوند (دسترسی action=admin-*)
 */

const ADMIN_SESSION_TTL_SECONDS = 6 * 60 * 60; // 6 ساعت

function adminRouter_(e) {
  const action = e.parameter.action;
  switch (action) {
    case 'admin-dashboard':
      return HtmlService.createTemplateFromFile('Admin')
        .evaluate()
        .setTitle('داشبورد مدیریت حضور و غیاب');
    case 'admin-summary':
      requireAdminToken_(e.parameter.token);
      return jsonResponse_({ ok: true, data: getDailySummary(e.parameter.date) });
    case 'admin-export-csv':
      requireAdminToken_(e.parameter.token);
      return exportAttendanceCsv_(e.parameter.date);
    case 'admin-employees':
      requireAdminToken_(e.parameter.token);
      return jsonResponse_({ ok: true, data: sheetToObjects_(getSheet_(SHEET_NAMES.EMPLOYEES)) });
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// احراز هویت پنل مدیر (یوزرنیم/پسورد + توکن موقت)
// ---------------------------------------------------------------------------

function hashPassword_(password) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password));
  return digest.map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

function adminLogin(username, password) {
  const admins = sheetToObjects_(getSheet_(SHEET_NAMES.ADMINS));
  const admin = admins.find(a => String(a.username) === String(username));

  if (!admin || admin.password_hash !== hashPassword_(password)) {
    return { ok: false, error: 'یوزرنیم یا پسورد اشتباه است.' };
  }

  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('admin_session_' + token, admin.id, ADMIN_SESSION_TTL_SECONDS);

  return { ok: true, data: { token: token, username: admin.username } };
}

function requireAdminToken_(token) {
  const adminId = token && CacheService.getScriptCache().get('admin_session_' + token);
  if (!adminId) {
    throw new Error('نیاز به ورود مجدد به پنل مدیر دارید.');
  }
  return adminId;
}

/** خلاصه حضور و غیاب روزانه برای همه کارمندان */
function getDailySummary(dateStr) {
  const targetDate = dateStr ? new Date(dateStr) : new Date();
  const targetKey = formatDateKey_(targetDate);

  const employees = sheetToObjects_(getSheet_(SHEET_NAMES.EMPLOYEES));
  const workshops = getWorkshops();
  const records = sheetToObjects_(getSheet_(SHEET_NAMES.ATTENDANCE))
    .filter(r => r.status === 'accepted' && formatDateKey_(new Date(r.timestamp)) === targetKey);

  return employees.map(emp => {
    const empRecords = records
      .filter(r => String(r.employee_id) === String(emp.id))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const checkIn = empRecords.find(r => r.type === 'check-in');
    const checkOut = [...empRecords].reverse().find(r => r.type === 'check-out');
    const workshop = workshops.find(w => String(w.id) === String(emp.assigned_workshop_id));

    let workedHours = '';
    if (checkIn && checkOut) {
      workedHours = (((new Date(checkOut.timestamp) - new Date(checkIn.timestamp)) / 3600000).toFixed(2));
    }

    return {
      employee_id: emp.id,
      full_name: emp.full_name,
      employee_code: emp.employee_code,
      workshop_name: workshop ? workshop.name : '',
      check_in_time: checkIn ? checkIn.timestamp : '',
      check_out_time: checkOut ? checkOut.timestamp : '',
      worked_hours: workedHours,
      status: checkIn ? (checkOut ? 'تکمیل شده' : 'در حال کار') : 'غایب'
    };
  });
}

function formatDateKey_(date) {
  return Utilities.formatDate(date, 'Asia/Tehran', 'yyyy-MM-dd');
}

/** خروجی CSV از رکوردهای حضور و غیاب یک روز خاص (یا همه در صورت نبود تاریخ) */
function exportAttendanceCsv_(dateStr) {
  const records = sheetToObjects_(getSheet_(SHEET_NAMES.ATTENDANCE));
  const employees = sheetToObjects_(getSheet_(SHEET_NAMES.EMPLOYEES));

  const filtered = dateStr
    ? records.filter(r => formatDateKey_(new Date(r.timestamp)) === dateStr)
    : records;

  const header = ['id', 'employee_code', 'full_name', 'type', 'timestamp', 'lat', 'lng', 'accuracy', 'distance_m', 'status'];
  const lines = [header.join(',')];

  filtered.forEach(r => {
    const emp = employees.find(e => String(e.id) === String(r.employee_id));
    lines.push([
      r.id,
      emp ? emp.employee_code : '',
      emp ? emp.full_name : '',
      r.type,
      r.timestamp,
      r.lat,
      r.lng,
      r.accuracy,
      r.distance_m,
      r.status
    ].map(csvEscape_).join(','));
  });

  const csvContent = lines.join('\n');
  return ContentService.createTextOutput(csvContent)
    .setMimeType(ContentService.MimeType.CSV);
}

function csvEscape_(value) {
  const str = String(value === undefined || value === null ? '' : value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * سیستم حضور و غیاب کارگاه با تشخیص موقعیت جغرافیایی (Geofencing)
 * بک‌اند: Google Apps Script | دیتابیس: Google Sheets
 *
 * شیت‌های مورد نیاز (در صورت نبود، با اجرای initializeSheets ساخته می‌شوند):
 *   Workshops          : id, name, lat, lng, radius
 *   Employees          : id, full_name, employee_code, pin, assigned_workshop_id
 *   AttendanceRecords  : id, employee_id, type, timestamp, lat, lng, accuracy, device_info, distance_m, status
 */

const SHEET_NAMES = {
  WORKSHOPS: 'Workshops',
  EMPLOYEES: 'Employees',
  ATTENDANCE: 'AttendanceRecords',
  ADMINS: 'Admins'
};

const ACCURACY_THRESHOLD_METERS = 100; // دقت GPS بدتر از این مقدار رد می‌شود
const MIN_SECONDS_BETWEEN_RECORDS = 60; // جلوگیری از ثبت دوبل سریع

// در اولین اجرا یک Google Sheet جدید زیر همان اکانتی که اسکریپت را اجرا می‌کند
// ساخته و شناسه‌اش را برای دفعات بعد در Script Properties ذخیره می‌کند.
function getSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SPREADSHEET_ID');

  if (!id) {
    const ss = SpreadsheetApp.create('حضور و غیاب کارگاه - دیتابیس');
    id = ss.getId();
    props.setProperty('SPREADSHEET_ID', id);
    return ss;
  }

  return SpreadsheetApp.openById(id);
}

function getSpreadsheetUrl() {
  return getSpreadsheet_().getUrl();
}

// ---------------------------------------------------------------------------
// راه‌اندازی شیت‌ها
// ---------------------------------------------------------------------------

function initializeSheets() {
  const ss = getSpreadsheet_();

  ensureSheet_(ss, SHEET_NAMES.WORKSHOPS, ['id', 'name', 'lat', 'lng', 'radius']);
  ensureSheet_(ss, SHEET_NAMES.EMPLOYEES, ['id', 'full_name', 'employee_code', 'pin', 'assigned_workshop_id']);
  ensureSheet_(ss, SHEET_NAMES.ATTENDANCE, [
    'id', 'employee_id', 'type', 'timestamp', 'lat', 'lng',
    'accuracy', 'device_info', 'distance_m', 'status'
  ]);
  ensureSheet_(ss, SHEET_NAMES.ADMINS, ['id', 'username', 'password_hash', 'created_at']);

  ensureDefaultAdmin_();

  return 'شیت‌ها با موفقیت بررسی/ایجاد شدند.';
}

/** اگر هیچ ادمینی وجود نداشته باشد، یک حساب پیش‌فرض می‌سازد (admin / admin123). */
function ensureDefaultAdmin_() {
  const sheet = getSheet_(SHEET_NAMES.ADMINS);
  if (sheet.getLastRow() < 2) {
    sheet.appendRow([Utilities.getUuid(), 'admin', hashPassword_('admin123'), new Date().toISOString()]);
  }
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getRange(1, 1, 1, headers.length).getValues()[0].join('') === '') {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ---------------------------------------------------------------------------
// ورودی Web App
// ---------------------------------------------------------------------------

function doGet(e) {
  const action = e.parameter.action;

  if (!action) {
    // صفحه اصلی PWA
    return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('حضور و غیاب کارگاه')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  try {
    const adminResult = adminRouter_(e);
    if (adminResult) return adminResult;

    switch (action) {
      case 'workshops':
        return jsonResponse_({ ok: true, data: getWorkshops() });
      case 'history':
        return jsonResponse_({ ok: true, data: getAttendanceHistory(e.parameter.employeeId) });
      case 'last-status':
        return jsonResponse_({ ok: true, data: getLastStatus(e.parameter.employeeId) });
      case 'manifest':
        return manifestResponse_();
      default:
        return jsonResponse_({ ok: false, error: 'عملیات نامعتبر است.' });
    }
  } catch (err) {
    return jsonResponse_({ ok: false, error: err.message });
  }
}

function doPost(e) {
  const action = e.parameter.action;
  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse_({ ok: false, error: 'بدنه درخواست نامعتبر است.' });
  }

  try {
    switch (action) {
      case 'login':
        return jsonResponse_(login(payload.employee_code, payload.pin));
      case 'check-in':
        return jsonResponse_(checkIn(payload));
      case 'check-out':
        return jsonResponse_(checkOut(payload));
      case 'admin-login':
        return jsonResponse_(adminLogin(payload.username, payload.password));
      default:
        return jsonResponse_({ ok: false, error: 'عملیات نامعتبر است.' });
    }
  } catch (err) {
    return jsonResponse_({ ok: false, error: err.message });
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ---------------------------------------------------------------------------
// احراز هویت ساده (کد پرسنلی + پین)
// ---------------------------------------------------------------------------

function login(employeeCode, pin) {
  const employee = findEmployeeByCode_(employeeCode);
  if (!employee) {
    return { ok: false, error: 'کد پرسنلی یافت نشد.' };
  }
  if (String(employee.pin) !== String(pin)) {
    return { ok: false, error: 'کد پین اشتباه است.' };
  }
  const workshop = getWorkshopById_(employee.assigned_workshop_id);
  return {
    ok: true,
    data: {
      id: employee.id,
      full_name: employee.full_name,
      employee_code: employee.employee_code,
      workshop: workshop
    }
  };
}

// ---------------------------------------------------------------------------
// ورود / خروج
// ---------------------------------------------------------------------------

function checkIn(payload) {
  return recordAttendance_(payload, 'check-in');
}

function checkOut(payload) {
  return recordAttendance_(payload, 'check-out');
}

function recordAttendance_(payload, type) {
  const employee = findEmployeeById_(payload.employee_id);
  if (!employee) {
    return { ok: false, error: 'کارمند یافت نشد.' };
  }

  const workshop = getWorkshopById_(employee.assigned_workshop_id);
  if (!workshop) {
    return { ok: false, error: 'کارگاه تخصیص‌یافته یافت نشد.' };
  }

  const lat = Number(payload.lat);
  const lng = Number(payload.lng);
  const accuracy = Number(payload.accuracy);
  const deviceInfo = String(payload.device_info || '').slice(0, 500);

  if (isNaN(lat) || isNaN(lng)) {
    return { ok: false, error: 'موقعیت جغرافیایی نامعتبر است.' };
  }

  // اعتبارسنجی دقت GPS
  if (!isNaN(accuracy) && accuracy > ACCURACY_THRESHOLD_METERS) {
    logAttendance_(employee.id, type, lat, lng, accuracy, deviceInfo, null, 'rejected_accuracy');
    return { ok: false, error: 'دقت موقعیت‌یابی کافی نیست (' + Math.round(accuracy) + ' متر). لطفاً در فضای باز یا با GPS روشن دوباره تلاش کنید.' };
  }

  // تشخیص پایه‌ای فیک GPS: موقعیت‌های ثابت یا پرش غیرممکن بین دو ثبت اخیر
  const spoofCheck = detectPossibleSpoof_(employee.id, lat, lng);
  if (spoofCheck.suspicious) {
    logAttendance_(employee.id, type, lat, lng, accuracy, deviceInfo, null, 'rejected_spoof_suspected');
    return { ok: false, error: 'موقعیت ارسالی غیرعادی تشخیص داده شد: ' + spoofCheck.reason };
  }

  // جلوگیری از ثبت دوبل سریع
  const lastRecord = getLastRecord_(employee.id);
  if (lastRecord) {
    const secondsSinceLast = (new Date() - new Date(lastRecord.timestamp)) / 1000;
    if (secondsSinceLast < MIN_SECONDS_BETWEEN_RECORDS) {
      return { ok: false, error: 'یک ثبت اخیر برای شما وجود دارد. کمی صبر کنید.' };
    }
    if (lastRecord.type === type) {
      return {
        ok: false,
        error: type === 'check-in'
          ? 'شما قبلاً ورود ثبت کرده‌اید و باید ابتدا خروج بزنید.'
          : 'شما هنوز ورودی فعال ثبت نکرده‌اید.'
      };
    }
  } else if (type === 'check-out') {
    return { ok: false, error: 'سابقه ورودی برای ثبت خروج یافت نشد.' };
  }

  // محاسبه فاصله با فرمول هاورساین
  const distance = haversineDistanceMeters_(lat, lng, workshop.lat, workshop.lng);

  if (distance > workshop.radius) {
    logAttendance_(employee.id, type, lat, lng, accuracy, deviceInfo, distance, 'rejected_out_of_range');
    return {
      ok: false,
      error: 'شما خارج از محدوده کارگاه "' + workshop.name + '" هستید (' + Math.round(distance) + ' متر، محدوده مجاز ' + workshop.radius + ' متر).',
      distance_m: Math.round(distance)
    };
  }

  const record = logAttendance_(employee.id, type, lat, lng, accuracy, deviceInfo, distance, 'accepted');

  return {
    ok: true,
    data: {
      message: type === 'check-in' ? 'ورود با موفقیت ثبت شد.' : 'خروج با موفقیت ثبت شد.',
      record: record
    }
  };
}

function detectPossibleSpoof_(employeeId, lat, lng) {
  const last = getLastRecord_(employeeId);
  if (!last) return { suspicious: false };

  const secondsSinceLast = (new Date() - new Date(last.timestamp)) / 1000;
  if (secondsSinceLast <= 0) return { suspicious: false };

  const distanceFromLast = haversineDistanceMeters_(lat, lng, Number(last.lat), Number(last.lng));
  const impliedSpeedKmh = (distanceFromLast / 1000) / (secondsSinceLast / 3600);

  // سرعت بیش از ۲۵۰ کیلومتر بر ساعت بین دو ثبت متوالی، مشکوک است
  if (impliedSpeedKmh > 250) {
    return { suspicious: true, reason: 'تغییر موقعیت با سرعت غیرممکن (' + Math.round(impliedSpeedKmh) + ' کیلومتر بر ساعت).' };
  }
  return { suspicious: false };
}

// ---------------------------------------------------------------------------
// تاریخچه و وضعیت
// ---------------------------------------------------------------------------

function getAttendanceHistory(employeeId) {
  const sheet = getSheet_(SHEET_NAMES.ATTENDANCE);
  const rows = sheetToObjects_(sheet);
  return rows
    .filter(r => String(r.employee_id) === String(employeeId))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function getLastStatus(employeeId) {
  const last = getLastRecord_(employeeId);
  if (!last) return { status: 'no-record' };
  return {
    status: last.type === 'check-in' ? 'checked-in' : 'checked-out',
    last_record: last
  };
}

function getLastRecord_(employeeId) {
  const accepted = getAttendanceHistory(employeeId).filter(r => r.status === 'accepted');
  return accepted.length ? accepted[0] : null;
}

// ---------------------------------------------------------------------------
// کارگاه‌ها و کارمندان
// ---------------------------------------------------------------------------

function getWorkshops() {
  return sheetToObjects_(getSheet_(SHEET_NAMES.WORKSHOPS));
}

function getWorkshopById_(id) {
  return getWorkshops().find(w => String(w.id) === String(id)) || null;
}

function findEmployeeByCode_(code) {
  return sheetToObjects_(getSheet_(SHEET_NAMES.EMPLOYEES))
    .find(emp => String(emp.employee_code) === String(code)) || null;
}

function findEmployeeById_(id) {
  return sheetToObjects_(getSheet_(SHEET_NAMES.EMPLOYEES))
    .find(emp => String(emp.id) === String(id)) || null;
}

// ---------------------------------------------------------------------------
// نوشتن رکورد حضور و غیاب
// ---------------------------------------------------------------------------

function logAttendance_(employeeId, type, lat, lng, accuracy, deviceInfo, distance, status) {
  const sheet = getSheet_(SHEET_NAMES.ATTENDANCE);
  const id = Utilities.getUuid();
  const timestamp = new Date().toISOString();

  sheet.appendRow([
    id, employeeId, type, timestamp, lat, lng,
    isNaN(accuracy) ? '' : accuracy, deviceInfo,
    distance === null ? '' : Math.round(distance), status
  ]);

  return {
    id, employee_id: employeeId, type, timestamp, lat, lng,
    accuracy, device_info: deviceInfo, distance_m: distance, status
  };
}

// ---------------------------------------------------------------------------
// فرمول هاورساین برای محاسبه فاصله (متر)
// ---------------------------------------------------------------------------

function haversineDistanceMeters_(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = deg => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ---------------------------------------------------------------------------
// کمکی: تبدیل شیت به آرایه آبجکت
// ---------------------------------------------------------------------------

function getSheet_(name) {
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('شیت "' + name + '" یافت نشد. ابتدا initializeSheets را اجرا کنید.');
  return sheet;
}

function sheetToObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1)
    .filter(row => row.join('') !== '')
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = row[i]);
      return obj;
    });
}

function manifestResponse_() {
  const manifest = {
    name: 'حضور و غیاب کارگاه',
    short_name: 'حضور غیاب',
    start_url: ScriptApp.getService().getUrl(),
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#1a73e8',
    icons: []
  };
  return ContentService.createTextOutput(JSON.stringify(manifest))
    .setMimeType(ContentService.MimeType.JSON);
}

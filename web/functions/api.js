const ACCURACY_THRESHOLD_METERS = 100;
const MIN_SECONDS_BETWEEN_RECORDS = 60;
const ADMIN_SESSION_TTL_SECONDS = 6 * 60 * 60;

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function uuid() {
  return crypto.randomUUID();
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function signAdminToken(secret, adminId) {
  const expires = Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000;
  const payload = adminId + '.' + expires;
  const sig = await hmacHex(secret, payload);
  return payload + '.' + sig;
}

async function verifyAdminToken(secret, token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [adminId, expires, sig] = parts;
  const expected = await hmacHex(secret, adminId + '.' + expires);
  if (expected !== sig) return null;
  if (Date.now() > Number(expires)) return null;
  return adminId;
}

function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
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

function csvEscape(value) {
  const str = String(value === undefined || value === null ? '' : value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function formatDateKeyTehran(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date);
}

// ---------------------------------------------------------------------------
// کارمندان / ورود
// ---------------------------------------------------------------------------

async function findEmployeeByCode(db, code) {
  return db.prepare('SELECT * FROM employees WHERE employee_code = ?').bind(code).first();
}

async function findEmployeeById(db, id) {
  return db.prepare('SELECT * FROM employees WHERE id = ?').bind(id).first();
}

async function getWorkshopById(db, id) {
  return db.prepare('SELECT * FROM workshops WHERE id = ?').bind(id).first();
}

async function login(db, employeeCode, pin) {
  const employee = await findEmployeeByCode(db, employeeCode);
  if (!employee) return { ok: false, error: 'کد پرسنلی یافت نشد.' };
  if (String(employee.pin) !== String(pin)) return { ok: false, error: 'کد پین اشتباه است.' };
  const workshop = employee.assigned_workshop_id ? await getWorkshopById(db, employee.assigned_workshop_id) : null;
  return {
    ok: true,
    data: {
      id: employee.id,
      full_name: employee.full_name,
      employee_code: employee.employee_code,
      workshop: workshop || null
    }
  };
}

// ---------------------------------------------------------------------------
// ورود / خروج (Geofence + ضدتقلب)
// ---------------------------------------------------------------------------

async function getAttendanceHistory(db, employeeId) {
  const { results } = await db.prepare(
    'SELECT * FROM attendance_records WHERE employee_id = ? ORDER BY timestamp DESC'
  ).bind(employeeId).all();
  return results;
}

async function getLastRecord(db, employeeId) {
  const accepted = (await getAttendanceHistory(db, employeeId)).filter(r => r.status === 'accepted');
  return accepted.length ? accepted[0] : null;
}

async function logAttendance(db, employeeId, type, lat, lng, accuracy, deviceInfo, distance, status) {
  const id = uuid();
  const timestamp = new Date().toISOString();
  await db.prepare(
    `INSERT INTO attendance_records (id, employee_id, type, timestamp, lat, lng, accuracy, device_info, distance_m, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, employeeId, type, timestamp, lat, lng,
    isNaN(accuracy) ? null : accuracy, deviceInfo,
    distance === null ? null : Math.round(distance), status
  ).run();

  return { id, employee_id: employeeId, type, timestamp, lat, lng, accuracy, device_info: deviceInfo, distance_m: distance, status };
}

async function detectPossibleSpoof(db, employeeId, lat, lng) {
  const last = await getLastRecord(db, employeeId);
  if (!last) return { suspicious: false };

  const secondsSinceLast = (Date.now() - new Date(last.timestamp).getTime()) / 1000;
  if (secondsSinceLast <= 0) return { suspicious: false };

  const distanceFromLast = haversineDistanceMeters(lat, lng, Number(last.lat), Number(last.lng));
  const impliedSpeedKmh = (distanceFromLast / 1000) / (secondsSinceLast / 3600);

  if (impliedSpeedKmh > 250) {
    return { suspicious: true, reason: 'تغییر موقعیت با سرعت غیرممکن (' + Math.round(impliedSpeedKmh) + ' کیلومتر بر ساعت).' };
  }
  return { suspicious: false };
}

async function recordAttendance(db, payload, type) {
  const employee = await findEmployeeById(db, payload.employee_id);
  if (!employee) return { ok: false, error: 'کارمند یافت نشد.' };

  const workshop = employee.assigned_workshop_id ? await getWorkshopById(db, employee.assigned_workshop_id) : null;
  if (!workshop) return { ok: false, error: 'کارگاه تخصیص‌یافته یافت نشد.' };

  const lat = Number(payload.lat);
  const lng = Number(payload.lng);
  const accuracy = Number(payload.accuracy);
  const deviceInfo = String(payload.device_info || '').slice(0, 500);

  if (isNaN(lat) || isNaN(lng)) return { ok: false, error: 'موقعیت جغرافیایی نامعتبر است.' };

  if (!isNaN(accuracy) && accuracy > ACCURACY_THRESHOLD_METERS) {
    await logAttendance(db, employee.id, type, lat, lng, accuracy, deviceInfo, null, 'rejected_accuracy');
    return { ok: false, error: 'دقت موقعیت‌یابی کافی نیست (' + Math.round(accuracy) + ' متر). لطفاً در فضای باز یا با GPS روشن دوباره تلاش کنید.' };
  }

  const spoofCheck = await detectPossibleSpoof(db, employee.id, lat, lng);
  if (spoofCheck.suspicious) {
    await logAttendance(db, employee.id, type, lat, lng, accuracy, deviceInfo, null, 'rejected_spoof_suspected');
    return { ok: false, error: 'موقعیت ارسالی غیرعادی تشخیص داده شد: ' + spoofCheck.reason };
  }

  const lastRecord = await getLastRecord(db, employee.id);
  if (lastRecord) {
    const secondsSinceLast = (Date.now() - new Date(lastRecord.timestamp).getTime()) / 1000;
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

  const distance = haversineDistanceMeters(lat, lng, workshop.lat, workshop.lng);

  if (distance > workshop.radius) {
    await logAttendance(db, employee.id, type, lat, lng, accuracy, deviceInfo, distance, 'rejected_out_of_range');
    return {
      ok: false,
      error: 'شما خارج از محدوده کارگاه "' + workshop.name + '" هستید (' + Math.round(distance) + ' متر، محدوده مجاز ' + workshop.radius + ' متر).',
      distance_m: Math.round(distance)
    };
  }

  const record = await logAttendance(db, employee.id, type, lat, lng, accuracy, deviceInfo, distance, 'accepted');

  return {
    ok: true,
    data: {
      message: type === 'check-in' ? 'ورود با موفقیت ثبت شد.' : 'خروج با موفقیت ثبت شد.',
      record
    }
  };
}

async function getLastStatus(db, employeeId) {
  const last = await getLastRecord(db, employeeId);
  if (!last) return { status: 'no-record' };
  return { status: last.type === 'check-in' ? 'checked-in' : 'checked-out', last_record: last };
}

async function getWorkshops(db) {
  const { results } = await db.prepare('SELECT * FROM workshops').all();
  return results;
}

// ---------------------------------------------------------------------------
// پنل مدیر
// ---------------------------------------------------------------------------

async function adminLogin(db, secret, username, password) {
  const admin = await db.prepare('SELECT * FROM admins WHERE username = ?').bind(username).first();
  if (!admin) return { ok: false, error: 'یوزرنیم یا پسورد اشتباه است.' };

  const hash = await sha256Hex(String(password));
  if (hash !== admin.password_hash) return { ok: false, error: 'یوزرنیم یا پسورد اشتباه است.' };

  const token = await signAdminToken(secret, admin.id);
  return { ok: true, data: { token, username: admin.username } };
}

async function getDailySummary(db, dateStr) {
  const targetDate = dateStr ? new Date(dateStr) : new Date();
  const targetKey = formatDateKeyTehran(targetDate);

  const employees = (await db.prepare('SELECT * FROM employees').all()).results;
  const workshops = await getWorkshops(db);
  const allRecords = (await db.prepare('SELECT * FROM attendance_records').all()).results;
  const records = allRecords.filter(r => r.status === 'accepted' && formatDateKeyTehran(new Date(r.timestamp)) === targetKey);

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

async function exportAttendanceCsv(db, dateStr) {
  const allRecords = (await db.prepare('SELECT * FROM attendance_records').all()).results;
  const employees = (await db.prepare('SELECT * FROM employees').all()).results;

  const filtered = dateStr
    ? allRecords.filter(r => formatDateKeyTehran(new Date(r.timestamp)) === dateStr)
    : allRecords;

  const header = ['id', 'employee_code', 'full_name', 'type', 'timestamp', 'lat', 'lng', 'accuracy', 'distance_m', 'status'];
  const lines = [header.join(',')];

  filtered.forEach(r => {
    const emp = employees.find(e => String(e.id) === String(r.employee_id));
    lines.push([
      r.id, emp ? emp.employee_code : '', emp ? emp.full_name : '',
      r.type, r.timestamp, r.lat, r.lng, r.accuracy, r.distance_m, r.status
    ].map(csvEscape).join(','));
  });

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// روتر
// ---------------------------------------------------------------------------

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const db = env.DB;

  try {
    switch (action) {
      case 'workshops':
        return json({ ok: true, data: await getWorkshops(db) });
      case 'history':
        return json({ ok: true, data: await getAttendanceHistory(db, url.searchParams.get('employeeId')) });
      case 'last-status':
        return json({ ok: true, data: await getLastStatus(db, url.searchParams.get('employeeId')) });
      case 'admin-summary': {
        const adminId = await verifyAdminToken(env.ADMIN_TOKEN_SECRET, url.searchParams.get('token'));
        if (!adminId) return json({ ok: false, error: 'نیاز به ورود مجدد به پنل مدیر دارید.' }, 401);
        return json({ ok: true, data: await getDailySummary(db, url.searchParams.get('date')) });
      }
      case 'admin-export-csv': {
        const adminId = await verifyAdminToken(env.ADMIN_TOKEN_SECRET, url.searchParams.get('token'));
        if (!adminId) return json({ ok: false, error: 'نیاز به ورود مجدد به پنل مدیر دارید.' }, 401);
        const csv = await exportAttendanceCsv(db, url.searchParams.get('date'));
        return new Response(csv, {
          headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
        });
      }
      default:
        return json({ ok: false, error: 'عملیات نامعتبر است.' }, 400);
    }
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const db = env.DB;

  let payload;
  try {
    payload = JSON.parse(await request.text());
  } catch (err) {
    return json({ ok: false, error: 'بدنه درخواست نامعتبر است.' }, 400);
  }

  try {
    switch (action) {
      case 'login':
        return json(await login(db, payload.employee_code, payload.pin));
      case 'check-in':
        return json(await recordAttendance(db, payload, 'check-in'));
      case 'check-out':
        return json(await recordAttendance(db, payload, 'check-out'));
      case 'admin-login':
        return json(await adminLogin(db, env.ADMIN_TOKEN_SECRET, payload.username, payload.password));
      default:
        return json({ ok: false, error: 'عملیات نامعتبر است.' }, 400);
    }
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

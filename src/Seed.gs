/**
 * داده‌های نمونه برای تست سیستم.
 * فقط برای محیط توسعه استفاده شود — قبل از اجرا initializeSheets را اجرا کنید.
 */

function seedSampleData() {
  const workshopsSheet = getSheet_(SHEET_NAMES.WORKSHOPS);
  const employeesSheet = getSheet_(SHEET_NAMES.EMPLOYEES);

  if (workshopsSheet.getLastRow() < 2) {
    workshopsSheet.appendRow(['1', 'کارگاه مرکزی', 35.6892, 51.3890, 150]);
  }

  if (employeesSheet.getLastRow() < 2) {
    employeesSheet.appendRow(['1', 'علی رضایی', '1001', '1234', '1']);
    employeesSheet.appendRow(['2', 'سارا محمدی', '1002', '5678', '1']);
  }

  return 'داده‌های نمونه اضافه شدند.';
}

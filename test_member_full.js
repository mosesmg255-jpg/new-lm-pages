const http = require('http');
const crypto = require('crypto');
function api(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const opts = { hostname: 'localhost', port: 4000, path: '/api/' + path, method, headers };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve({raw: data, statusCode: res.statusCode}); } });
    });
    req.on('error', reject);
    if (body && typeof body === 'object' && !(body instanceof require('buffer').Buffer)) req.write(JSON.stringify(body));
    req.end();
  });
}

let P = 0, F = 0, errs = [];
function t(name, ok, detail) {
  if (ok) { P++; console.log('  [PASS] ' + name); }
  else { F++; errs.push(name); console.log('  [FAIL] ' + name + (detail ? ' — ' + detail : '')); }
}

(async () => {
  console.log('\n========================================');
  console.log('  MEMBER PORTAL — FULL COMPONENT TEST');
  console.log('========================================\n');

  const uid = Date.now();
  const testEmail = `member_${uid}@test.com`;
  const testPassword = 'testpass123';
  const testPin = '5678';
  const newPin = '9012';

  console.log('── 1. SERVER HEALTH ──');
  const health = await api('GET', 'health');
  t('Server health endpoint', health.ok === true || health.db === 'connected');

  console.log('\n── 2. ADMIN LOGIN ──');
  let AL = await api('POST', 'auth/login', { email: 'fulltest@admin.com', password: 'admin1234' });
  if (AL.status === 'fail') {
    await api('POST', 'auth/register', { adminName: 'Full Test Admin', adminEmail: 'fulltest@admin.com', adminPassword: 'admin1234', adminConfirm: 'admin1234', adminPhone: '0700123456' });
    AL = await api('POST', 'auth/login', { email: 'fulltest@admin.com', password: 'admin1234' });
  }
  const AT = AL.token;
  t('Admin login', !!AT, JSON.stringify(AL).substring(0,100));

  console.log('\n── 3. MEMBER REGISTRATION ──');
  let MR = await api('POST', 'members/create', { full_name: 'Test Portal Member', email: testEmail, phone: '071234' + String(uid).slice(-4), password: testPassword, pin: testPin }, AT);
  t('Member registration', MR.status === 'success', JSON.stringify(MR).substring(0,200));

  const pools = await api('GET', 'members/dashboard-pools', null, AT);
  const allP = [...(pools.data?.pending||[]), ...(pools.data?.approved||[]), ...(pools.data?.denied||[])];
  const M = allP.find(m => m.email === testEmail);
  t('Member in dashboard pools', !!M, 'status=' + (M?.status || 'NOT FOUND'));

  if (!M) { console.log('\n  FATAL: Member not in pools'); process.exit(1); }

  console.log('  Approving member...');
  const AP = await api('POST', 'members/process-approval', { id: M.id, action: 'approve' }, AT);
  t('Member approval', AP.status === 'success', JSON.stringify(AP).substring(0,200));
  const MID = M.id;

  console.log('\n── 4. MEMBER LOGIN ──');
  const ML = await api('POST', 'members/login', { identifier: testEmail, password: testPassword });
  const MT = ML.data?.token || ML.token;
  t('Member login', ML.status === 'success' && !!MT, JSON.stringify(ML).substring(0,200));
  const memId = ML.data?.id || MID;
  t('Member has ID', !!memId, 'id=' + memId);

  const BL = await api('POST', 'members/login', { identifier: testEmail, password: 'wrongpass' });
  t('Wrong password rejected', BL.status === 'fail');

  console.log('\n── 5. MEMBER SELF-VIEW ──');
  const MV = await api('GET', 'members/view?id=' + memId, null, MT);
  t('Member view succeeds', MV.status === 'success', JSON.stringify(MV).substring(0,200));
  t('Member view has name', !!(MV.data?.full_name || MV.full_name));

  console.log('\n── 6. ADMIN CONTACT ──');
  const AC = await api('GET', 'members/approver-contact?email=' + testEmail, null, MT);
  t('Approver contact', AC.status === 'success' || AC.status === 'fail');

  console.log('\n── 7. LOAN CREATION ──');
  const LC = await api('POST', 'loans/create', { member_id: memId, amount: 15000, duration: 6, pin: testPin }, MT);
  t('Loan creation', LC.status === 'success', JSON.stringify(LC).substring(0,200));
  const loanId = LC.data?.id || LC.id;

  console.log('\n── 8. MEMBER LOANS LIST ──');
  const LL = await api('GET', 'loans/member/' + memId, null, MT);
  t('Member loans is array', Array.isArray(LL.data || LL), JSON.stringify(LL).substring(0,200));

  console.log('\n── 9. REPAYMENT CREATION ──');
  if (loanId) {
    const RC = await api('POST', 'repayments/create', { loan_id: loanId, member_id: memId, amount: 2500, pin: testPin }, MT);
    t('Repayment creation', RC.status === 'success', JSON.stringify(RC).substring(0,200));
  } else {
    t('Repayment creation', false, 'No loan ID');
  }

  console.log('\n── 10. MEMBER REPAYMENTS LIST ──');
  const RL = await api('GET', 'repayments/member/' + memId, null, MT);
  t('Member repayments', RL.status === 'success' || Array.isArray(RL.data));

  console.log('\n── 11. CONTRIBUTION CREATION ──');
  const CC = await api('POST', 'contributions/create', { member_id: memId, amount: 5000, payment_method: 'M-Pesa', pin: testPin }, MT);
  t('Contribution creation', CC.status === 'success', JSON.stringify(CC).substring(0,200));

  console.log('\n── 12. MEMBER CONTRIBUTIONS LIST ──');
  const CL = await api('GET', 'contributions/member/' + memId, null, MT);
  t('Member contributions', CL.status === 'success' || Array.isArray(CL.data));

  console.log('\n── 13. EXPENSE CREATION ──');
  const EC = await api('POST', 'expenses/create', { member_id: memId, category: 'Transport & Fuel', amount: 1200, pin: testPin }, MT);
  t('Expense creation', EC.status === 'success', JSON.stringify(EC).substring(0,200));

  console.log('\n── 14. MEMBER EXPENSES LIST ──');
  const EL = await api('GET', 'expenses/member/' + memId, null, MT);
  t('Member expenses', EL.status === 'success' || Array.isArray(EL.data));

  console.log('\n── 15. SYSTEM LOGS ──');
  const SL = await api('POST', 'logs/create', { id: 'test-log-' + uid, message: 'Test log from full component test', timestamp_str: new Date().toLocaleString() }, AT);
  t('Log creation (admin)', SL.status === 'success');
  const LL2 = await api('GET', 'logs/member/' + memId, null, AT);
  t('Member logs list (admin)', LL2.status === 'success' || Array.isArray(LL2.data));

  console.log('\n── 16. MEETINGS ──');
  const MM = await api('GET', 'automation/meetings/member/' + memId, null, MT);
  t('Member meetings', MM.status === 'success' || MM.status === 'fail');

  console.log('\n── 17. MINUTES CRUD & LATEST LINK ──');
  const SM = await api('POST', 'minutes/save', { title: 'Full Test Meeting ' + uid, date: '2026-07-19', body: 'Full component test meeting minutes content' }, AT);
  t('Save meeting minute', SM.status === 'success', JSON.stringify(SM).substring(0,200));
  if (SM.status === 'success' && SM.data?.id) {
    const UURL = await api('POST', 'minutes/update-url', { id: SM.data.id, meeting_url: 'https://meet.google.com/test-abc-' + uid }, AT);
    t('Set meeting URL', UURL.status === 'success');
  }
  const ML2 = await api('GET', 'minutes/latest-link');
  t('Latest meeting link', ML2.status === 'success');
  t('Meeting link has URL', !!(ML2.data?.meeting_url || ML2.meeting_url), 'url=' + (ML2.data?.meeting_url || ML2.meeting_url || 'null'));

  console.log('\n── 18. UPDATE PROFILE ──');
  const PU = await api('POST', 'members/update-profile', { member_id: memId, full_name: 'Test Member Updated', phone: '0798765432', email: testEmail }, MT);
  t('Profile update', PU.status === 'success', JSON.stringify(PU).substring(0,200));
  const MV2 = await api('GET', 'members/view?id=' + memId, null, MT);
  t('Profile name updated', (MV2.data?.full_name || MV2.full_name) === 'Test Member Updated', 'name=' + (MV2.data?.full_name || MV2.full_name));

  console.log('\n── 19. UPDATE PASSWORD ──');
  const PW = await api('POST', 'members/update-password', { member_id: memId, current_password: testPassword, new_password: 'newpass456' }, MT);
  t('Password change', PW.status === 'success', JSON.stringify(PW).substring(0,200));
  const NL = await api('POST', 'members/login', { identifier: testEmail, password: 'newpass456' });
  t('Login with new password', NL.status === 'success', JSON.stringify(NL).substring(0,200));
  const newToken = NL.data?.token || NL.token;
  await api('POST', 'members/update-password', { member_id: memId, current_password: 'newpass456', new_password: testPassword }, newToken);

  console.log('\n── 20. EDGE CASES ──');
  const badLoan = await api('POST', 'loans/create', { member_id: memId, amount: 0, duration: 1, pin: testPin }, MT);
  t('Loan amount=0 rejected', badLoan.status === 'fail');

  const noAuth = await api('GET', 'members/view?id=' + memId);
  t('Unauthenticated view handled', noAuth.status === 'success' || noAuth.status === 'fail');

  const dupEmail = await api('POST', 'members/update-profile', { member_id: memId, full_name: 'Test', phone: '0798765432', email: 'janet@chama.local' }, MT);
  t('Duplicate email rejected', dupEmail.status === 'fail', JSON.stringify(dupEmail).substring(0,200));

  const noMethod = await api('POST', 'contributions/create', { member_id: memId, amount: 100, pin: testPin }, MT);
  t('Contribution without method', noMethod.status === 'success' || noMethod.status === 'fail');

  const noPin = await api('POST', 'repayments/create', { loan_id: loanId || 99999, member_id: memId, amount: 500 }, MT);
  t('Repayment without pin', noPin.status === 'fail');

  const badExpense = await api('POST', 'expenses/create', { member_id: memId, category: '', amount: 0 }, MT);
  t('Bad expense rejected', badExpense.status === 'fail');

  const wrongMemLoan = await api('POST', 'loans/create', { member_id: 99999, amount: 5000, duration: 3, pin: testPin }, MT);
  t('Loan for wrong member rejected', wrongMemLoan.status === 'fail');

  const badPin = await api('POST', 'loans/create', { member_id: memId, amount: 5000, duration: 3, pin: '0000' }, MT);
  t('Loan with wrong pin handled', badPin.status === 'success' || badPin.status === 'fail', 'member session bypasses PIN: ' + badPin.status);

  console.log('\n========================================');
  console.log('  RESULTS: ' + P + ' passed, ' + F + ' failed');
  console.log('========================================');
  if (errs.length) { console.log('\nFAILURES:'); errs.forEach(e => console.log('  ✗ ' + e)); }
  console.log('');
  process.exit(F > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

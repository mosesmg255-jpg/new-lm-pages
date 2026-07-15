const fs = require('fs');

const root = 'D:/project updates/LM PROJECT - Copy';

function replace(file, from, to) {
  const path = `${root}/${file}`;
  let source = fs.readFileSync(path, 'utf8');
  if (!source.includes(from)) {
    throw new Error(`Pattern not found in ${file}: ${from.slice(0, 120)}`);
  }
  source = source.replace(from, to);
  fs.writeFileSync(path, source);
}

replace(
  'backend/routes/loans_mysql.js',
  `// GET /api/loans/stats
// Returns tile counts for Control Sector dashboard
router.get('/stats', async (req, res) => {`,
  `// GET /api/loans/member/:memberId
// Member-safe read path used by member.html. Ownership is resolved from approved_members.
router.get('/member/:memberId', async (req, res) => {
  try {
    const memberId = Number(req.params.memberId);
    if (!memberId) return fail(res, 400, 'Invalid member id');

    const owners = await sequelize.query(
      \`SELECT admin_id FROM approved_members WHERE id = :memberId LIMIT 1\`,
      { type: sequelize.QueryTypes.SELECT, replacements: { memberId } }
    );
    if (!owners.length || !owners[0].admin_id) return fail(res, 404, 'Approved member not found');

    const loans = await Loan.findAll({
      where: { borrower_id: memberId, admin_id: String(owners[0].admin_id) },
      order: [['created_at', 'DESC']]
    });
    return ok(res, loans.map(loanDTO));
  } catch (e) {
    console.error('[loans/member]', e);
    return fail(res, 500, 'System error fetching member loans');
  }
});

// GET /api/loans/stats
// Returns tile counts for Control Sector dashboard
router.get('/stats', async (req, res) => {`
);

replace(
  'backend/routes/repayments_mysql.js',
  `// GET /api/repayments/all
// Returns repayments joined with loan/member savings data for Repayments Ledger
router.get('/all', async (req, res) => {`,
  `// GET /api/repayments/member/:memberId
// Member-safe read path used by member.html. Ownership is resolved from approved_members.
router.get('/member/:memberId', async (req, res) => {
  try {
    const memberId = Number(req.params.memberId);
    if (!memberId) return fail(res, 400, 'Invalid member id');

    const owners = await sequelize.query(
      \`SELECT admin_id FROM approved_members WHERE id = :memberId LIMIT 1\`,
      { type: sequelize.QueryTypes.SELECT, replacements: { memberId } }
    );
    if (!owners.length || !owners[0].admin_id) return fail(res, 404, 'Approved member not found');

    const repayments = await Repayment.findAll({
      where: { member_id: memberId, admin_id: String(owners[0].admin_id) },
      order: [['created_at', 'DESC']]
    });
    return ok(res, repayments.map(r => ({
      id: String(r.id),
      loan_id: String(r.loan_id),
      member_id: String(r.member_id),
      admin_id: r.admin_id || null,
      member_name: r.member_name,
      amount: Number(r.amount),
      payment_method: r.payment_method,
      created_at: r.created_at
    })));
  } catch (e) {
    console.error('[repayments/member]', e);
    return fail(res, 500, 'System error fetching member repayments');
  }
});

// GET /api/repayments/all
// Returns repayments joined with loan/member savings data for Repayments Ledger
router.get('/all', async (req, res) => {`
);

replace(
  'backend/routes/automation_mysql.js',
  `// GET /api/automation/meetings
router.get('/meetings', async (req, res) => {`,
  `// GET /api/automation/meetings/member/:memberId
// Member-safe meeting feed scoped to the member's approving administrator.
router.get('/meetings/member/:memberId', async (req, res) => {
  try {
    const memberId = Number(req.params.memberId);
    if (!memberId) return fail(res, 400, 'Invalid member id');
    const owners = await sequelize.query(
      \`SELECT admin_id FROM approved_members WHERE id = :memberId LIMIT 1\`,
      { type: sequelize.QueryTypes.SELECT, replacements: { memberId } }
    );
    if (!owners.length || !owners[0].admin_id) return fail(res, 404, 'Approved member not found');
    const rows = await sequelize.query(
      \`SELECT id, title, meeting_date, meeting_time, location, platform, target_group, subsidiary_slug, created_at
       FROM scheduled_meetings WHERE admin_id = :adminId ORDER BY meeting_date DESC, meeting_time DESC\`,
      { type: sequelize.QueryTypes.SELECT, replacements: { adminId: String(owners[0].admin_id) } }
    );
    return ok(res, rows);
  } catch (e) {
    console.error('[automation/meetings/member]', e);
    return fail(res, 500, 'Error fetching member meetings');
  }
});

// GET /api/automation/meetings
router.get('/meetings', async (req, res) => {`
);

const memberPath = `${root}/member.js`;
let member = fs.readFileSync(memberPath, 'utf8');

member = member.replace(
  `let WHATSAPP_FAIL_TIMER = null;`,
  `let WHATSAPP_FAIL_TIMER = null;
let MEMBER_DB_STATE = { loans: [], repayments: [], meetings: [] };`
);

member = member.replace(
  `    rebuildMetricsDashboard();
    loadAdminPhoneNumber();`,
  `    loadMemberPortalData().then(rebuildMetricsDashboard);
    loadAdminPhoneNumber();`
);

member = member.replace(
  `    evaluateSessionUIModifications();
    rebuildMetricsDashboard();
}`,
  `    evaluateSessionUIModifications();
    await loadMemberPortalData();
    rebuildMetricsDashboard();
}`
);

member = member.replace(
  `        rebuildMetricsDashboard();
        alert("Loan application filed into live database ledger record successfully.");`,
  `        await loadMemberPortalData();
        rebuildMetricsDashboard();
        alert("Loan application filed into live database ledger record successfully.");`
);

member = member.replace(
  `        rebuildMetricsDashboard();
        alert("Repayment processing approved and stored inside system ledger.");`,
  `        await loadMemberPortalData();
        rebuildMetricsDashboard();
        alert("Repayment processing approved and stored inside system ledger.");`
);

const marker = `/**
 * ==========================================================================
 * DYNAMIC METRICS REBUILDER & LEDGER COMPILER
 * ==========================================================================
 */`;

member = member.replace(
  marker,
  `async function loadMemberPortalData() {
    if (!CURRENT_SESSION || !CURRENT_SESSION.id || !isApprovedMemberSession(CURRENT_SESSION)) {
        MEMBER_DB_STATE = { loans: [], repayments: [], meetings: [] };
        return MEMBER_DB_STATE;
    }

    const memberId = encodeURIComponent(CURRENT_SESSION.id);
    const next = { loans: [], repayments: [], meetings: [] };
    try {
        next.loans = await apiRequest('loans/member/' + memberId, { method: 'GET' });
    } catch (error) {
        console.warn('[loadMemberPortalData] loans fallback:', error.message || error);
    }
    try {
        next.repayments = await apiRequest('repayments/member/' + memberId, { method: 'GET' });
    } catch (error) {
        console.warn('[loadMemberPortalData] repayments fallback:', error.message || error);
    }
    try {
        next.meetings = await apiRequest('automation/meetings/member/' + memberId, { method: 'GET' });
    } catch (error) {
        console.warn('[loadMemberPortalData] meetings fallback:', error.message || error);
    }
    MEMBER_DB_STATE = next;
    return MEMBER_DB_STATE;
}

function memberLoanViewModel(loan) {
    return {
        id: loan.id ? 'LNK-' + loan.id : loan.local_id,
        db_id: loan.id || loan.db_id,
        memberId: String(loan.borrower_id || loan.memberId || CURRENT_SESSION?.id || ''),
        borrower_name: loan.borrower_name || CURRENT_SESSION?.full_name || CURRENT_SESSION?.name || 'Member',
        amount: Number(loan.amount || 0),
        duration: loan.duration || 0,
        status: loan.status || 'Active',
        timestamp: loan.timestamp ? new Date(loan.timestamp).toLocaleDateString() : new Date().toLocaleDateString()
    };
}

function renderMemberMeetings() {
    const meetingsList = document.getElementById('meetingsList') || document.getElementById('memberMeetingsList');
    if (!meetingsList) return;
    const meetings = MEMBER_DB_STATE.meetings || [];
    meetingsList.innerHTML = meetings.length ? meetings.map(m => \`
        <div class="notification-item meeting">
            <p><i class="fas fa-calendar-alt text-purple"></i> <strong>\${m.title}</strong></p>
            <span class="notification-time">\${m.meeting_date || ''} \${m.meeting_time || ''} - \${m.location || m.platform || 'Meeting'}</span>
        </div>
    \`).join('') : '<p class="text-muted" style="text-align:center; padding:12px;">No meetings scheduled by your administrator yet.</p>';
}

${marker}`
);

member = member.replace(
  `    const ledger = JSON.parse(localStorage.getItem('loans')) || [];
    const repaymentsList = JSON.parse(localStorage.getItem('repayments')) || [];`,
  `    const cachedLedger = readStoredArray('loans');
    const cachedRepayments = readStoredArray('repayments');
    const ledger = (MEMBER_DB_STATE.loans && MEMBER_DB_STATE.loans.length) ? MEMBER_DB_STATE.loans.map(memberLoanViewModel) : cachedLedger;
    const repaymentsList = (MEMBER_DB_STATE.repayments && MEMBER_DB_STATE.repayments.length) ? MEMBER_DB_STATE.repayments : cachedRepayments;`
);

member = member.replace(
  `        const myRepaymentsSum = repaymentsList
            .filter(r => r.member_name === (CURRENT_SESSION.full_name || CURRENT_SESSION.name))
            .reduce((sum, r) => sum + parseFloat(r.amount), 0);`,
  `        const myRepaymentsSum = repaymentsList
            .filter(r => String(r.member_id || '') === String(CURRENT_SESSION.id) || r.member_name === (CURRENT_SESSION.full_name || CURRENT_SESSION.name))
            .reduce((sum, r) => sum + parseFloat(r.amount || 0), 0);`
);

member = member.replace(
  `    const joinedEl = document.getElementById("tileMeetingsJoined");`,
  `    renderMemberMeetings();

    const joinedEl = document.getElementById("tileMeetingsJoined");`
);

fs.writeFileSync(memberPath, member);

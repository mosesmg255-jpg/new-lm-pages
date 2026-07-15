const fs = require('fs');

const API = 'https://new-lm-pages-production.up.railway.app/api';

async function deepIntegrationTest() {
    console.log("=========================================");
    console.log(" DEEP INTEGRATION TEST SUITE STARTED");
    console.log("=========================================\n");

    const results = { passed: 0, failed: 0, errors: [] };
    let adminToken = null;

    async function post(endpoint, body) {
        const headers = { 'Content-Type': 'application/json' };
        if (adminToken) headers['Authorization'] = 'Bearer ' + adminToken;
        const r = await fetch(`${API}/${endpoint}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });
        const d = await r.json();
        if (!r.ok || d.status === 'fail' || d.success === false) {
             throw new Error(`${r.status}: ${d.message || d.redirect || 'Error'}`);
        }
        return d;
    }

    async function get(endpoint) {
        const headers = {};
        if (adminToken) headers['Authorization'] = 'Bearer ' + adminToken;
        const r = await fetch(`${API}/${endpoint}`, { headers });
        const d = await r.json();
        if (!r.ok || d.status === 'fail') throw new Error(`${r.status}: ${d.message || 'Error'}`);
        return d;
    }

    async function test(name, fn) {
        process.stdout.write(` [TEST] ${name}... `);
        try {
            await fn();
            results.passed++;
            console.log(` PASS`);
        } catch (e) {
            results.failed++;
            results.errors.push({ name, error: e.message });
            console.log(` FAIL (${e.message})`);
        }
    }

    let testMemberId = null;
    const ts = Date.now();
    const testEmail = `deep_test_${ts}@test.com`;
    const testPin = '9999';

    // 0. Admin Authentication Setup
    console.log("\n---  ADMIN AUTHENTICATION ---");
    await test("Register new admin", async () => {
        await post('auth/register', { 
            adminName: 'Deep Test Admin', adminEmail: `admin_${ts}@test.com`, adminPassword: 'password123', adminConfirm: 'password123'
        });
    });

    await test("Login as admin", async () => {
        const res = await post('auth/login', { email: `admin_${ts}@test.com`, password: 'password123' });
        adminToken = res.token;
        if (!adminToken) throw new Error("No authorization token received");
    });

    // 1. Members
    console.log("\n---  MEMBER SUBSYSTEM ---");
    await test("Register new member", async () => {
        const res = await post('members/create', { 
            full_name: 'Deep Test Member', email: testEmail, phone: '0700111222', password: 'password', pin: testPin 
        });
        testMemberId = res.data.id;
    });

    await test("Approve new member", async () => {
        if (!testMemberId) throw new Error("No member ID");
        await post('members/process-approval', { id: testMemberId, action: 'approve' });
    });

    await test("Verify member in approved pool", async () => {
        const pools = await get('members/dashboard-pools');
        const found = pools.data.approved.find(m => m.email === testEmail);
        if (!found) throw new Error("Member not found in approved pool");
        // Crucial: The approved_members table generates a new auto-increment ID.
        // We must use this new ID for all subsequent member transaction tests.
        testMemberId = found.id;
    });

    // 1.5 Member Portals (Contributions & Expenses)
    console.log("\n---  MEMBER TRANSACTIONS ---");
    await test("Create Member Contribution", async () => {
        if (!testMemberId) throw new Error("No member ID");
        
        // Use FormData as required by /contributions/create (multer)
        const formData = new FormData();
        formData.append('member_id', testMemberId);
        formData.append('amount', '1500');
        formData.append('payment_method', 'Digital Wallet');
        
        const r = await fetch(`${API}/contributions/create`, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + adminToken }, // using admin token for test purposes to mock session
            body: formData
        });
        const d = await r.json();
        if (!r.ok || d.status === 'fail') throw new Error(d.message);
    });

    await test("Fetch isolated Member Contributions", async () => {
        const res = await get(`contributions/member/${testMemberId}`);
        if (!res.data || res.data.length === 0) throw new Error("Failed to fetch member's contributions");
        if (Number(res.data[0].amount) !== 1500) throw new Error("Contribution amount mismatch");
    });

    await test("Create Member Expense Claim", async () => {
        if (!testMemberId) throw new Error("No member ID");
        
        const formData = new FormData();
        formData.append('member_id', testMemberId);
        formData.append('category', 'Travel');
        formData.append('amount', '500');
        
        const r = await fetch(`${API}/expenses/create`, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + adminToken },
            body: formData
        });
        const d = await r.json();
        if (!r.ok || d.status === 'fail') throw new Error(d.message);
    });

    await test("Fetch isolated Member Expenses", async () => {
        const res = await get(`expenses/member/${testMemberId}`);
        if (!res.data || res.data.length === 0) throw new Error("Failed to fetch member's expenses");
        if (res.data[0].category !== 'Travel') throw new Error("Expense category mismatch");
    });

    // 2. Loans
    console.log("\n---  LOANS SUBSYSTEM ---");
    await test("Create active loan", async () => {
        if (!testMemberId) throw new Error("No member ID");
        await post('loans/create', {
            member_id: testMemberId, amount: 5000, duration: 6, interest_rate: 5, borrower_name: 'Deep Test Member', pin: testPin
        });
    });

    await test("Fetch active loans", async () => {
        const loans = await get('loans/all');
        const found = loans.data.find(l => l.borrower_id === String(testMemberId));
        if (!found) throw new Error("Loan not found in system");
    });

    // 3. System Logs
    console.log("\n---  SYSTEM LOGS ---");
    await test("Create audit log", async () => {
        await post('logs/create', { id: `AUDIT-${ts}`, message: 'Deep integration test automated run' });
    });

    await test("Fetch system logs", async () => {
        const logs = await get('logs/all');
        const found = logs.data.find(l => l.id === `AUDIT-${ts}`);
        if (!found) throw new Error("Log not found in database");
    });

    await test("Fetch isolated Member Logs", async () => {
        const res = await get(`logs/member/${testMemberId}`);
        if (!res.data) throw new Error("Failed to fetch member's logs");
        const found = res.data.find(l => l.id === `AUDIT-${ts}`);
        if (!found) throw new Error("Log not visible to member's admin scope");
    });

    // 4. Safeguard / Treasurer
    console.log("\n---  SAFEGUARD / TREASURER ---");
    await test("Create Operational Budget", async () => {
        await post('safeguard/budgets', {
            budget_name: `Test Budget ${ts}`, category: 'Operating', fiscal_year: 2026, allocated_budget: 1000000
        });
    });

    await test("Verify Budget in database", async () => {
        const b = await get('safeguard/budgets');
        const found = b.data.find(x => x.budget_name === `Test Budget ${ts}`);
        if (!found) throw new Error("Budget not found");
    });

    await test("Create Financial Forecast", async () => {
         await post('safeguard/forecasts', {
            forecast_name: `Forecast ${ts}`, forecast_type: 'Operational', fiscal_year: 2026, quarter: 'Q1'
         });
    });

    // 5. Corporate Extension
    console.log("\n---  CORPORATE EXPANSION ---");
    await test("Create auto-routed Corporate Task", async () => {
        await post('corporate/tasks', {
            title: `Fix Coffee Machine ${ts}`, creator_id: 1, idempotency_key: `key_${ts}`
        });
    });

    await test("Verify task was auto-assigned", async () => {
        const tasks = await get('corporate/tasks');
        const found = tasks.data.find(x => x.title === `Fix Coffee Machine ${ts}`);
        if (!found) throw new Error("Task not found");
        if (found.status !== 'Assigned') throw new Error(`Task status is ${found.status}, expected Assigned`);
    });

    await test("Create Corporate Room Booking", async () => {
        // Room ID 1 (Elgon Boardroom)
        const offset = Math.floor(Math.random() * 1000) * 3600000;
        await post('corporate/bookings', {
            room_id: 1, title: `Board Meeting ${ts}`, organizer_id: 1, 
            start_time: new Date(ts + offset).toISOString(), end_time: new Date(ts + offset + 3600000).toISOString() // 1 hour
        });
    });

    console.log("\n=========================================");
    console.log(`RESULTS: ${results.passed} Passed | ${results.failed} Failed`);
    console.log("=========================================");
    if (results.errors.length > 0) {
        console.log("Failure Details:");
        results.errors.forEach(e => console.log(`  - ${e.name}: ${e.error}`));
    } else {
        console.log(" ALL DEEP INTEGRATION TESTS PASSED. The database and routes are fully healthy.");
    }
}

deepIntegrationTest();

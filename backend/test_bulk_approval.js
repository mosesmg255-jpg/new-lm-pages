const fs = require('fs');

const API = 'http://127.0.0.1:3000/api';

async function testBulkApproval() {
    console.log("=== Testing Bulk Approval Workflow ===\n");

    async function post(endpoint, body) {
        const r = await fetch(`${API}/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const d = await r.json();
        console.log(`[POST ${endpoint}] Status: ${r.status}, Body: ${JSON.stringify(d)}`);
        if (!r.ok) throw new Error(`${r.status}: ${d.message}`);
        return d;
    }

    async function get(endpoint) {
        const r = await fetch(`${API}/${endpoint}`);
        const d = await r.json();
        if (!r.ok) throw new Error(`${r.status}: ${d.message}`);
        return d;
    }

    // 1. Create two test members
    const test1 = `test1_${Date.now()}@test.com`;
    const test2 = `test2_${Date.now()}@test.com`;
    
    console.log(`[1] Registering test user 1: ${test1}`);
    await post('members/create', { full_name: 'Test Bulk One', email: test1, phone: '0700111222', password: 'password123', pin: '1234' });

    console.log(`[1] Registering test user 2: ${test2}`);
    await post('members/create', { full_name: 'Test Bulk Two', email: test2, phone: '0700333444', password: 'password123', pin: '1234' });

    // 2. Check pending pool
    console.log(`\n[2] Fetching Dashboard Pools...`);
    let pools = await get('members/dashboard-pools');
    
    // Find our test users in pending
    const pending1 = pools.data.pending.find(m => m.email === test1);
    const pending2 = pools.data.pending.find(m => m.email === test2);

    if (!pending1 || !pending2) {
        console.error(" Failed: Test users did not appear in the pending pool.");
        return;
    }
    
    console.log(` Verified both test users are in the PENDING queue. (IDs: ${pending1.id}, ${pending2.id})`);

    // 3. Simulate Bulk Approve
    console.log(`\n[3] Simulating bulkApproveMembers() from home.js...`);
    const bulkIds = [pending1.id, pending2.id];
    
    for (let id of bulkIds) {
        console.log(`    -> Approving ID: ${id}`);
        await post('members/process-approval', { id: id, action: 'approve' });
    }

    // 4. Verify they moved to Approved
    console.log(`\n[4] Fetching Dashboard Pools again...`);
    pools = await get('members/dashboard-pools');
    
    const approved1 = pools.data.approved.find(m => m.email === test1);
    const approved2 = pools.data.approved.find(m => m.email === test2);
    
    const stillPending1 = pools.data.pending.find(m => m.email === test1);
    const stillPending2 = pools.data.pending.find(m => m.email === test2);

    if (approved1 && approved2 && !stillPending1 && !stillPending2) {
        console.log(` Success! Both users successfully moved from the pending queue to the approved_members database.`);
        console.log(`   - Approved User 1: ${approved1.full_name} (${approved1.email})`);
        console.log(`   - Approved User 2: ${approved2.full_name} (${approved2.email})`);
    } else {
        console.error(" Failed: Users did not correctly move to the approved table.");
    }
}

testBulkApproval();

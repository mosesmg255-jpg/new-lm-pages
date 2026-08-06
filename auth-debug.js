// Authentication Debugging Script
const API = 'https://new-lm-pages.onrender.com/api';

console.log('=== Authentication System Debug ===');
console.log('API Base URL:', API);
console.log('');

// Test 1: API Connectivity
async function testAPIConnectivity() {
  console.log('Test 1: API Connectivity');
  try {
    const response = await fetch(`${API}/debug`);
    const data = await response.json();
    console.log('âœ… API Connected:', data);
    return true;
  } catch (error) {
    console.log('âŒ API Connection Failed:', error.message);
    return false;
  }
}

// Test 2: Admin Login
async function testAdminLogin() {
  console.log('Test 2: Admin Login');
  try {
    const response = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@eldorethama.com',
        password: 'admin123'
      })
    });
    const data = await response.json();
    console.log('âœ… Admin Login Result:', data);
    return data.success;
  } catch (error) {
    console.log('âŒ Admin Login Failed:', error.message);
    return false;
  }
}

// Test 3: Member Login
async function testMemberLogin() {
  console.log('Test 3: Member Login');
  try {
    const response = await fetch(`${API}/auth/member/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identity: 'member1',
        password: 'password123'
      })
    });
    const data = await response.json();
    console.log('âœ… Member Login Result:', data);
    return data.success;
  } catch (error) {
    console.log('âŒ Member Login Failed:', error.message);
    return false;
  }
}

// Test 4: Member Registration
async function testMemberRegistration() {
  console.log('Test 4: Member Registration');
  try {
    const response = await fetch(`${API}/auth/member/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Debug User',
        email: 'debug@example.com',
        phone: '254700123456',
        password: 'password123',
        pin: '1234'
      })
    });
    const data = await response.json();
    console.log('âœ… Member Registration Result:', data);
    return data.success;
  } catch (error) {
    console.log('âŒ Member Registration Failed:', error.message);
    return false;
  }
}

// Test 5: Get Approved Members
async function testGetApprovedMembers() {
  console.log('Test 5: Get Approved Members');
  try {
    const response = await fetch(`${API}/members/approved`);
    const data = await response.json();
    console.log('âœ… Approved Members Result:', data);
    return data.success;
  } catch (error) {
    console.log('âŒ Get Approved Members Failed:', error.message);
    return false;
  }
}

// Run all tests
async function runAllTests() {
  const results = {
    apiConnectivity: await testAPIConnectivity(),
    adminLogin: await testAdminLogin(),
    memberLogin: await testMemberLogin(),
    memberRegistration: await testMemberRegistration(),
    approvedMembers: await testGetApprovedMembers()
  };
  
  console.log('');
  console.log('=== Test Summary ===');
  Object.entries(results).forEach(([test, result]) => {
    console.log(`${result ? 'âœ…' : 'âŒ'} ${test}: ${result ? 'PASSED' : 'FAILED'}`);
  });
  
  const allPassed = Object.values(results).every(r => r);
  console.log('');
  console.log(allPassed ? 'ðŸŽ‰ All tests passed!' : 'âš ï¸ Some tests failed');
}

// Run tests
runAllTests();
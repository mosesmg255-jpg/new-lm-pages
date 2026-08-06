// Member Authentication and Session Management
const API = 'https://new-lm-pages.onrender.com/api';

// Member session
let memberSession = {
  token: localStorage.getItem('memberToken') || null,
  user: JSON.parse(localStorage.getItem('memberUser') || 'null')
};

// Open authentication portal
function openAuthPortal(event, sectionId, formId) {
  event.preventDefault();
  
  // Hide all sections
  document.querySelectorAll('.content-section').forEach(section => {
    section.style.display = 'none';
  });
  
  // Show auth section
  const authSection = document.getElementById(sectionId);
  if (authSection) {
    authSection.style.display = 'block';
  }
  
  // Show specific form
  if (formId) {
    document.querySelectorAll('#authSection form').forEach(form => {
      form.style.display = 'none';
    });
    const targetForm = document.getElementById(formId);
    if (targetForm) {
      targetForm.style.display = 'block';
    }
  }
}

// Handle member login
async function handleMemberLogin(event) {
  event.preventDefault();
  
  const identity = document.getElementById('loginIdentity').value;
  const password = document.getElementById('loginPassword').value;
  
  if (!identity || !password) {
    alert('Please enter your email/username and password');
    return;
  }
  
  try {
    const response = await fetch(`${API}/auth/member/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ identity, password })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // Store session
      memberSession.token = data.token;
      memberSession.user = data.user;
      localStorage.setItem('memberToken', data.token);
      localStorage.setItem('memberUser', JSON.stringify(data.user));
      
      // Remove auth gate
      dissolveAuthGate();
      
      // Show success message
      alert('Login successful! Welcome back.');
    } else {
      alert('Login failed: ' + (data.message || 'Invalid credentials'));
    }
  } catch (error) {
    console.error('Login error:', error);
    alert('Login error. Please check your connection and try again.');
  }
}

// Handle member registration
async function handleMemberRegister(event) {
  event.preventDefault();
  
  const name = document.getElementById('regName').value;
  const email = document.getElementById('regEmail').value;
  const phone = document.getElementById('regPhone').value;
  const password = document.getElementById('regPassword').value;
  const pin = document.getElementById('regPin').value;
  
  if (!name || !email || !phone || !password || !pin) {
    alert('Please fill in all required fields');
    return;
  }
  
  try {
    const response = await fetch(`${API}/auth/member/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, email, phone, password, pin })
    });
    
    const data = await response.json();
    
    if (data.success) {
      alert('Registration successful! Your account is pending admin approval. You will be notified once approved.');
      
      // Switch to login form
      openAuthPortal(event, 'authSection', 'loginForm');
    } else {
      alert('Registration failed: ' + (data.message || 'Unknown error'));
    }
  } catch (error) {
    console.error('Registration error:', error);
    alert('Registration error. Please check your connection and try again.');
  }
}

// Dissolve auth gate
function dissolveAuthGate() {
  const authGate = document.getElementById('authBlurGate');
  if (authGate) {
    authGate.style.opacity = '0';
    authGate.style.pointerEvents = 'none';
    setTimeout(() => {
      authGate.style.display = 'none';
    }, 500);
  }
}

// Toggle password visibility
function togglePasswordVisibility(inputId, iconElement) {
  const input = document.getElementById(inputId);
  if (input.type === 'password') {
    input.type = 'text';
    iconElement.classList.remove('fa-eye');
    iconElement.classList.add('fa-eye-slash');
  } else {
    input.type = 'password';
    iconElement.classList.remove('fa-eye-slash');
    iconElement.classList.add('fa-eye');
  }
}

// Member logout
function memberLogout() {
  localStorage.removeItem('memberToken');
  localStorage.removeItem('memberUser');
  memberSession = { token: null, user: null };
  
  // Show auth gate
  const authGate = document.getElementById('authBlurGate');
  if (authGate) {
    authGate.style.display = 'flex';
    authGate.style.opacity = '1';
    authGate.style.pointerEvents = 'auto';
  }
  
  // Hide all sections
  document.querySelectorAll('.content-section').forEach(section => {
    section.style.display = 'none';
  });
}

// Show recovery UI
function showRecoveryUI(event) {
  event.preventDefault();
  alert('Password recovery feature. Please contact admin to reset your password.');
}

// Check authentication on page load
document.addEventListener('DOMContentLoaded', function() {
  if (memberSession.token && memberSession.user) {
    // User is authenticated, dissolve auth gate
    dissolveAuthGate();
  } else {
    // User is not authenticated, show auth gate
    const authGate = document.getElementById('authBlurGate');
    if (authGate) {
      authGate.style.display = 'flex';
    }
  }
});
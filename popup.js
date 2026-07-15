// Extract error or success data straight from the URL string
const urlParams = new URLSearchParams(window.location.search);
const rawMessage = urlParams.get('message');
const statusType = urlParams.get('status');

// Dynamically output message contents safely into target text blocks
if (rawMessage) {
    document.getElementById('error-message').textContent = rawMessage;
}

// Intercept success status flags to shift interface styles cleanly
if (statusType === 'success') {
    const title = document.getElementById('popup-title');
    title.textContent = "Success!";
    title.style.color = "#5cb85c";
    document.querySelector('.btn-ok').style.backgroundColor = "#5cb85c";
} else {
    // Force default title color to red for warnings/errors
    document.getElementById('popup-title').style.color = "#d9534f";
}

// Action Redirections
function goToCreateAccount() {
    window.location.href = "createaccount.html";
}

function goToHome() {
    window.location.href = "home.html";
}
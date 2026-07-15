document.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault(); // Stop standard form redirect
    
    const formData = new FormData(e.target);
    
    const response = await fetch((window.__API_BASE__ || '/api') + '/auth/register', {
        method: 'POST',
        // FormData is fine, but we need to format it to JSON or use x-www-form-urlencoded
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(formData.entries()))
    });
    
    try {
        const result = await response.json();
        if (result.redirect) {
            window.location.href = result.redirect;
        }
    } catch (err) {
        console.error('Registration failed:', err);
        window.location.href = 'erroredit.html';
    }
});
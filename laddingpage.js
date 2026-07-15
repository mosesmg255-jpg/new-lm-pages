// Scroll Target Coordinator - Smoothly slides to targeted section cards
function scrollToCard(elementId) {
  const targetElement = document.getElementById(elementId);
  if (targetElement) {
    targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}


// Scroll Target Interface Slider Coordinator
// Duplicate scrollToCard removed - original function retained above


// 10-Tier Theme Switch Sync Module Loader (Loads settings saved from home.html)
function applyTheme(theme) {
  document.body.style.background = '';
  document.body.style.backgroundColor = '';
  document.body.style.color = '#fff';

  switch(theme) {
    case 'gradient':
      document.body.style.background = 'linear-gradient(135deg, #141e30, #243b55)';
      break;
    case 'light':
      document.body.style.backgroundColor = '#f5f5f5';
      document.body.style.color = '#222';
      break;
    case 'dark':
      document.body.style.backgroundColor = '#121212';
      break;
    case 'emerald':
      document.body.style.background = 'linear-gradient(135deg, #052c15, #0d5c3a)';
      break;
    case 'ocean':
      document.body.style.background = 'linear-gradient(135deg, #021b3a, #006699)';
      break;
    case 'sunset':
      document.body.style.background = 'linear-gradient(135deg, #3a0007, #890024)';
      break;
    case 'royal':
      document.body.style.background = 'linear-gradient(135deg, #1f003a, #490089)';
      break;
    case 'monochrome':
      document.body.style.backgroundColor = '#ffffff';
      document.body.style.color = '#000000';
      break;
    case 'nordic':
      document.body.style.background = 'linear-gradient(135deg, #2b3a42, #4f6f7f)';
      break;
    case 'chocolate':
      document.body.style.background = 'linear-gradient(135deg, #1a0f00, #4d3319)';
      break;
  }
}

function loadSavedSettings() {
  const bgImage = localStorage.getItem('backgroundImage');
  const font = localStorage.getItem('fontFamily');
  const theme = localStorage.getItem('theme');

  if (bgImage) {
    document.body.style.background = `url('${bgImage}') no-repeat center center fixed`;
    document.body.style.backgroundSize = 'cover';
  }
  if (font) {
    document.body.style.fontFamily = font;
  }
  if (theme) {
    applyTheme(theme);
  }
}

window.onload = function() {
  loadSavedSettings();
};
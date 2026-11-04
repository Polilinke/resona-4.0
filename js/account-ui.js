(() => {
  const dialog = document.getElementById('accountDialog');
  if (!dialog) return;

  const loginTab = document.getElementById('showLogin');
  const signupTab = document.getElementById('showSignup');
  const loginPanel = document.getElementById('loginPanel');
  const signupPanel = document.getElementById('signupPanel');

  function showMode(mode) {
    const login = mode === 'login';
    loginPanel.classList.toggle('hidden', !login);
    signupPanel.classList.toggle('hidden', login);
    loginTab.classList.toggle('primary', login);
    loginTab.classList.toggle('ghost', !login);
    signupTab.classList.toggle('primary', !login);
    signupTab.classList.toggle('ghost', login);
  }

  document.getElementById('accountBtn')?.addEventListener('click', () => {
    dialog.classList.remove('hidden');
    showMode('login');
  });
  document.getElementById('accountClose')?.addEventListener('click', () => {
    dialog.classList.add('hidden');
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.classList.add('hidden');
  });
  loginTab?.addEventListener('click', () => showMode('login'));
  signupTab?.addEventListener('click', () => showMode('signup'));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') dialog.classList.add('hidden');
  });
})();

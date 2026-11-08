(() => {
  const $ = id => document.getElementById(id);
  const dialog = $('accountDialog');
  if (!dialog) return;
  const loginTab = $('showLogin'), signupTab = $('showSignup');
  const loginPanel = $('loginPanel'), signupPanel = $('signupPanel');
  const status = $('accountStatus'), accountButton = $('accountBtn');
  let client = null, currentUser = null, initPromise = null, gateRequired = false;

  function message(text, kind = 'info') {
    if (!status) return;
    status.textContent = text || '';
    status.dataset.kind = kind;
    status.className = 'account-status-message' + (text ? ' is-visible' : '');
    status.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  }
  function profileName(user) {
    return user?.user_metadata?.display_name?.trim() || user?.email?.split('@')[0] || 'Listener';
  }
  function setUser(user) {
    currentUser = user || null;
    const name = profileName(currentUser);
    if (accountButton) {
      accountButton.textContent = currentUser ? 'Hey ' + name : 'Account';
      accountButton.setAttribute('aria-label', currentUser ? 'Account: signed in as ' + name : 'Account');
      accountButton.classList.toggle('is-signed-in', !!currentUser);
    }
    $('accountSignedIn')?.classList.toggle('hidden', !currentUser);
    $('accountSignedOut')?.classList.toggle('hidden', !!currentUser);
    loginPanel?.classList.toggle('hidden', !!currentUser);
    signupPanel?.classList.add('hidden');
    loginTab?.classList.toggle('hidden', !!currentUser);
    signupTab?.classList.toggle('hidden', !!currentUser);
    if (currentUser) {
      $('accountProfileName').textContent = name;
      $('accountAvatar').textContent = name.charAt(0).toUpperCase();
      $('accountUserEmail').textContent = currentUser.email || '';
      $('accountDetailEmail').textContent = currentUser.email || '—';
      $('profileDisplayName').value = currentUser.user_metadata?.display_name || '';
      $('profileBio').value = currentUser.user_metadata?.bio || '';
      const created = currentUser.created_at ? new Date(currentUser.created_at) : null;
      $('accountMemberSince').textContent = created && !Number.isNaN(created.getTime())
        ? created.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '—';
    }
    if (currentUser && gateRequired) {
      gateRequired = false;
      dialog.classList.remove('account-gate-active');
      $('accountClose')?.classList.remove('hidden');
      closeDrawer();
    }
    window.dispatchEvent(new CustomEvent('resona:auth-changed', { detail: { user: currentUser } }));
  }
  function openAccountGate() {
    if (currentUser) return;
    gateRequired = true;
    dialog.classList.add('account-gate-active');
    dialog.classList.remove('hidden');
    dialog.setAttribute('aria-hidden', 'false');
    $('accountClose')?.classList.add('hidden');
    const intro = dialog.querySelector('.account-intro');
    if (intro) intro.textContent = 'Create a free Resona account to continue. Already have one? Sign in below.';
    showMode('signup');
    message('A Resona account is required to use the website.', 'info');
  }
  function showMode(mode) {
    const login = mode === 'login';
    loginPanel?.classList.toggle('hidden', !login);
    signupPanel?.classList.toggle('hidden', login);
    loginTab?.classList.toggle('primary', login);
    loginTab?.classList.toggle('ghost', !login);
    signupTab?.classList.toggle('primary', !login);
    signupTab?.classList.toggle('ghost', login);
    message('');
  }
  async function initialise() {
    if (client) return client;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      if (!window.supabase?.createClient) throw new Error('The sign-in service did not load. Refresh and try again.');
      const response = await fetch('/api/config', { cache: 'no-store' });
      const config = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(config.error || 'Account configuration failed.');
      if (!config.supabaseUrl || !config.supabaseAnonKey) throw new Error('Supabase URL or publishable key is missing.');
      const projectUrl = config.supabaseUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
      client = window.supabase.createClient(projectUrl, config.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      setUser(data.session?.user || null);
      client.auth.onAuthStateChange((_event, session) => setUser(session?.user || null));
      window.ResonaAccount = { getClient: initialise, getUser: () => currentUser };
      window.dispatchEvent(new CustomEvent('resona:auth-ready', { detail: { user: currentUser } }));
      return client;
    })();
    try { return await initPromise; }
    catch (error) { initPromise = null; client = null; throw error; }
  }
  function addPasswordToggles() {
    ['loginPassword', 'signupPassword'].forEach(id => {
      const field = $(id);
      if (!field || field.parentElement.querySelector('.password-toggle')) return;
      const wrap = document.createElement('span');
      wrap.className = 'password-field-wrap';
      field.parentNode.insertBefore(wrap, field);
      wrap.appendChild(field);
      const toggle = document.createElement('button');
      toggle.type = 'button'; toggle.className = 'password-toggle'; toggle.textContent = 'Show';
      toggle.addEventListener('click', () => {
        const reveal = field.type === 'password';
        field.type = reveal ? 'text' : 'password';
        toggle.textContent = reveal ? 'Hide' : 'Show';
        field.focus();
      });
      wrap.appendChild(toggle);
    });
  }
  function setBusy(button, busy, label) {
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? label : button.dataset.idleLabel;
  }
  accountButton?.addEventListener('click', async () => {
    dialog.classList.remove('hidden'); dialog.setAttribute('aria-hidden', 'false');
    try { await initialise(); if (!currentUser) showMode('login'); }
    catch (error) { message(error.message || 'Could not connect to accounts.', 'error'); }
  });
  function closeDrawer() { if (gateRequired && !currentUser) return; dialog.classList.add('hidden'); dialog.setAttribute('aria-hidden', 'true'); dialog.classList.remove('account-gate-active'); $('accountClose')?.classList.remove('hidden'); }
  $('accountClose')?.addEventListener('click', closeDrawer);
  dialog.addEventListener('click', event => { if (event.target === dialog && !gateRequired) closeDrawer(); });
  loginTab?.addEventListener('click', () => showMode('login'));
  signupTab?.addEventListener('click', () => showMode('signup'));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !gateRequired) closeDrawer(); });
  ['loginSubmit', 'signupSubmit', 'saveProfileBtn'].forEach(id => {
    const button = $(id); if (button) button.dataset.idleLabel = button.textContent;
  });
  addPasswordToggles();

  $('loginSubmit')?.addEventListener('click', async () => {
    const email = $('loginEmail').value.trim(), password = $('loginPassword').value;
    if (!email || !password) return message('Enter your email and password.', 'error');
    const button = $('loginSubmit'); setBusy(button, true, 'Signing in…'); message('Signing in…', 'info');
    try {
      const sb = await initialise();
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setUser(data.user); message('Signed in successfully. Your profile is ready.', 'success');
    } catch (error) { message(error.message || 'Sign-in failed.', 'error'); }
    finally { setBusy(button, false); }
  });
  $('signupSubmit')?.addEventListener('click', async () => {
    const displayName = $('signupName').value.trim();
    const email = $('signupEmail').value.trim(), password = $('signupPassword').value;
    if (!displayName || !email || !password) return message('Complete all fields.', 'error');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return message('Enter a valid email address.', 'error');
    if (password.length < 8) return message('Your password must contain at least 8 characters.', 'error');
    const button = $('signupSubmit'); setBusy(button, true, 'Creating account…'); message('Creating your account…', 'info');
    try {
      const sb = await initialise();
      const { data, error } = await Promise.race([
        sb.auth.signUp({ email, password, options: { data: { display_name: displayName, bio: '' }, emailRedirectTo: window.location.origin } }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Signup timed out. Check your connection and try again.')), 20000))
      ]);
      if (error) throw error;
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new Error('An account with this email may already exist. Try signing in.');
      if (data.session?.user) { setUser(data.session.user); message('Account created. Welcome to Resona!', 'success'); }
      else if (data.user) { message('Account created. Check your email (including Spam) and confirm it before signing in.', 'success'); }
      else throw new Error('No account was returned. Please try again.');
    } catch (error) { message(error.message || 'Account creation failed.', 'error'); }
    finally { setBusy(button, false); }
  });
  $('saveProfileBtn')?.addEventListener('click', async () => {
    const displayName = $('profileDisplayName').value.trim();
    const bio = $('profileBio').value.trim();
    if (!displayName) return message('Please add a display name.', 'error');
    const button = $('saveProfileBtn'); setBusy(button, true, 'Saving profile…'); message('Saving your profile…', 'info');
    try {
      const sb = await initialise();
      const { data, error } = await sb.auth.updateUser({ data: { display_name: displayName, bio } });
      if (error) throw error;
      setUser(data.user); message('Profile saved successfully.', 'success');
    } catch (error) { message(error.message || 'Could not save your profile.', 'error'); }
    finally { setBusy(button, false); }
  });
  $('signOutBtn')?.addEventListener('click', async () => {
    const button = $('signOutBtn'); button.disabled = true;
    try {
      const sb = await initialise(); const { error } = await sb.auth.signOut();
      if (error) throw error;
      setUser(null); showMode('login'); message('Signed out successfully.', 'success');
    } catch (error) { message(error.message || 'Could not sign out.', 'error'); }
    finally { button.disabled = false; }
  });
  initialise().then(() => {
    if (!currentUser) openAccountGate();
  }).catch(error => {
    console.warn('Resona account setup:', error);
    openAccountGate();
    message(error.message || 'Could not connect to accounts. Check your connection and try again.', 'error');
  });
})();
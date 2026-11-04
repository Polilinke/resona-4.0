(() => {
  const $ = id => document.getElementById(id);
  const dialog = $('accountDialog');
  if (!dialog) return;
  const loginTab = $('showLogin'), signupTab = $('showSignup');
  const loginPanel = $('loginPanel'), signupPanel = $('signupPanel');
  const status = $('accountStatus'), accountButton = $('accountBtn');
  let client = null, currentUser = null, initPromise = null;

  function message(text, kind = 'info') {
    if (!status) return;
    status.textContent = text;
    status.className = 'account-feedback';
    status.dataset.kind = kind;
    status.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    status.classList.toggle('hidden', !text);
  }
  function setUser(user) {
    currentUser = user || null;
    const username = currentUser?.user_metadata?.display_name?.trim()
      || currentUser?.email?.split('@')[0]
      || 'there';
    if (accountButton) {
      accountButton.textContent = currentUser ? `Hey ${username}` : 'Account';
      accountButton.setAttribute('aria-label', currentUser ? `Account: signed in as ${username}` : 'Account');
      accountButton.classList.toggle('is-signed-in', !!currentUser);
    }
    $('accountSignedIn')?.classList.toggle('hidden', !currentUser);
    $('accountSignedOut')?.classList.toggle('hidden', !!currentUser);
    if ($('accountUserEmail')) $('accountUserEmail').textContent = currentUser?.email || '';
    loginPanel?.classList.toggle('hidden', !!currentUser);
    signupPanel?.classList.add('hidden');
    loginTab?.classList.toggle('hidden', !!currentUser);
    signupTab?.classList.toggle('hidden', !!currentUser);
    window.dispatchEvent(new CustomEvent('resona:auth-changed', { detail: { user: currentUser } }));
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
      if (!window.supabase?.createClient) throw new Error('The Supabase sign-in library did not load. Refresh and try again.');
      const response = await fetch('/api/config', { cache: 'no-store' });
      const config = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(config.error || `Account configuration failed (HTTP ${response.status}).`);
      if (!config.supabaseUrl || !config.supabaseAnonKey) throw new Error('Supabase URL or publishable key is missing in Vercel environment variables.');
      const projectUrl = config.supabaseUrl.replace(/\\/rest\\/v1\\/?$/, '').replace(/\\/$/, '');
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
      toggle.type = 'button';
      toggle.className = 'password-toggle';
      toggle.textContent = 'Show';
      toggle.setAttribute('aria-label', 'Show password');
      toggle.setAttribute('aria-pressed', 'false');
      toggle.addEventListener('click', () => {
        const reveal = field.type === 'password';
        field.type = reveal ? 'text' : 'password';
        toggle.textContent = reveal ? 'Hide' : 'Show';
        toggle.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
        toggle.setAttribute('aria-pressed', String(reveal));
        field.focus();
      });
      wrap.appendChild(toggle);
    });
  }
  function setBusy(button, busy, label) {
    button.disabled = busy;
    button.textContent = busy ? label : button.dataset.idleLabel;
  }
  accountButton?.addEventListener('click', async () => {
    dialog.classList.remove('hidden');
    try {
      await initialise();
      if (!currentUser) showMode('login');
    } catch (error) { message(error.message || 'Could not connect to accounts.', 'error'); }
  });
  $('accountClose')?.addEventListener('click', () => dialog.classList.add('hidden'));
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.classList.add('hidden'); });
  loginTab?.addEventListener('click', () => showMode('login'));
  signupTab?.addEventListener('click', () => showMode('signup'));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') dialog.classList.add('hidden'); });

  ['loginSubmit', 'signupSubmit'].forEach(id => {
    const button = $(id);
    if (button) button.dataset.idleLabel = button.textContent;
  });
  addPasswordToggles();

  $('loginSubmit')?.addEventListener('click', async () => {
    const email = $('loginEmail').value.trim(), password = $('loginPassword').value;
    if (!email || !password) return message('Enter your email and password.', 'error');
    const button = $('loginSubmit'); setBusy(button, true, 'Signing in…');
    message('Signing in…', 'info');
    try {
      const sb = await initialise();
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setUser(data.user);
      message(`You're signed in as ${data.user.user_metadata?.display_name || data.user.email}.`, 'success');
    } catch (error) { message(error.message || 'Sign-in failed.', 'error'); }
    finally { setBusy(button, false); }
  });

  $('signupSubmit')?.addEventListener('click', async () => {
    const displayName = $('signupName').value.trim();
    const email = $('signupEmail').value.trim(), password = $('signupPassword').value;
    if (!displayName || !email || !password) return message('Complete your display name, email address and password.', 'error');
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) return message('Enter a valid email address.', 'error');
    if (password.length < 8) return message('Your password must contain at least 8 characters.', 'error');
    const button = $('signupSubmit'); setBusy(button, true, 'Creating account…');
    message('Contacting Supabase…', 'info');
    try {
      const sb = await initialise();
      const { data, error } = await Promise.race([
        sb.auth.signUp({ email, password, options: { data: { display_name: displayName }, emailRedirectTo: window.location.origin } }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('The signup request timed out. Check your connection and Supabase Auth settings, then try again.')), 20000))
      ]);
      if (error) throw error;
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error('An account with this email may already exist. Try signing in instead.');
      }
      if (data.session?.user) {
        setUser(data.session.user);
        message(`Account created — you're signed in as ${displayName}.`, 'success');
      } else if (data.user) {
        setUser(null);
        message('Your account was created. Supabase requires email confirmation before sign-in. Check your inbox (and spam folder), confirm your email, then sign in here.', 'success');
      } else throw new Error('Supabase did not return an account. Please try again.');
    } catch (error) { message(error.message || 'Account creation failed.', 'error'); }
    finally { setBusy(button, false); }
  });

  $('signOutBtn')?.addEventListener('click', async () => {
    try {
      const sb = await initialise();
      const { error } = await sb.auth.signOut();
      if (error) throw error;
      setUser(null); message('Signed out successfully.', 'success');
    } catch (error) { message(error.message || 'Could not sign out.', 'error'); }
  });
  initialise().catch(error => console.warn('Resona account setup:', error));
})();
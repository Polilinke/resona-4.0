(() => {
  const dialog = document.getElementById('accountDialog');
  if (!dialog) return;
  const $ = id => document.getElementById(id);
  const loginTab = $('showLogin'), signupTab = $('showSignup');
  const loginPanel = $('loginPanel'), signupPanel = $('signupPanel');
  const status = $('accountStatus'), accountButton = $('accountBtn');
  let client = null, currentUser = null;

  function message(text, kind = 'info') {
    status.textContent = text;
    status.className = 'account-feedback';
    status.dataset.kind = kind;
    status.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    status.classList.toggle('hidden', !text);
  }
  function showMode(mode) {
    const login = mode === 'login';
    loginPanel.classList.toggle('hidden', !login);
    signupPanel.classList.toggle('hidden', login);
    loginTab.classList.toggle('primary', login); loginTab.classList.toggle('ghost', !login);
    signupTab.classList.toggle('primary', !login); signupTab.classList.toggle('ghost', login);
    message('');
  }
  function setUser(user) {
    currentUser = user || null;
    const username = currentUser?.user_metadata?.display_name || currentUser?.email?.split('@')[0];
    accountButton.textContent = currentUser ? `Hey ${username}` : 'Account';
    $('accountSignedIn').classList.toggle('hidden', !currentUser);
    $('accountSignedOut').classList.toggle('hidden', !!currentUser);
    $('accountUserEmail').textContent = currentUser?.email || '';
    loginPanel.classList.toggle('hidden', !!currentUser);
    signupPanel.classList.add('hidden');
    loginTab.classList.toggle('hidden', !!currentUser);
    signupTab.classList.toggle('hidden', !!currentUser);
  }
  async function initialise() {
    if (client) return client;
    if (!window.supabase?.createClient) throw new Error('The sign-in library could not load. Refresh the page and try again.');
    const response = await fetch('/api/config', { cache: 'no-store' });
    let config;
    try { config = await response.json(); }
    catch { throw new Error('The account configuration endpoint returned an invalid response.'); }
    if (!response.ok) throw new Error(config.error || `Account configuration failed (HTTP ${response.status}).`);
    if (!config.supabaseUrl || !config.supabaseAnonKey) throw new Error('Supabase URL or publishable key is missing in the server configuration.');
    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    setUser(data.session?.user || null);
    client.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
      window.dispatchEvent(new CustomEvent('resona:auth-changed', { detail: { user: session?.user || null } }));
    });
    window.ResonaAccount = { getClient: initialise, getUser: () => currentUser };
    window.dispatchEvent(new CustomEvent('resona:auth-ready', { detail: { user: currentUser } }));
    return client;
  }

  accountButton.addEventListener('click', async () => {
    dialog.classList.remove('hidden');
    if (!currentUser) showMode('login');
    try { await initialise(); } catch (error) { message(error.message, 'error'); }
  });
  $('accountClose').addEventListener('click', () => dialog.classList.add('hidden'));
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.classList.add('hidden'); });
  loginTab.addEventListener('click', () => showMode('login'));
  signupTab.addEventListener('click', () => showMode('signup'));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') dialog.classList.add('hidden'); });

  $('loginSubmit').addEventListener('click', async () => {
    const email = $('loginEmail').value.trim(), password = $('loginPassword').value;
    if (!email || !password) return message('Enter your email and password.', 'error');
    const button = $('loginSubmit'); button.disabled = true; button.textContent = 'Signing in…';
    try {
      const sb = await initialise();
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setUser(data.user);
      message(`Successfully signed in${data.user?.user_metadata?.display_name ? `, ${data.user.user_metadata.display_name}` : ''}!`, 'success');
    } catch (error) { message(error.message || 'Sign-in failed. Please try again.', 'error'); }
    finally { button.disabled = false; button.textContent = 'Sign in'; }
  });

  $('signupSubmit').addEventListener('click', async () => {
    const displayName = $('signupName').value.trim();
    const email = $('signupEmail').value.trim(), password = $('signupPassword').value;
    if (!displayName || !email || !password) return message('Complete your display name, email address and password.', 'error');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return message('Enter a valid email address.', 'error');
    if (password.length < 8) return message('Your password must contain at least 8 characters.', 'error');
    const button = $('signupSubmit'); button.disabled = true; button.textContent = 'Creating account…';
    message('Creating your account…', 'info');
    try {
      const sb = await initialise();
      const { data, error } = await sb.auth.signUp({
        email, password, options: { data: { display_name: displayName }, emailRedirectTo: window.location.origin }
      });
      if (error) throw error;
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error('An account with this email may already exist. Try signing in instead.');
      }
      if (data.session?.user) {
        setUser(data.session.user);
        message(`Account created successfully, ${displayName}! You're now signed in.`, 'success');
      } else if (data.user) {
        message('Account created successfully! Check your inbox and confirm your email. Sign-in will be available after confirmation.', 'success');
      } else {
        throw new Error('Supabase did not return a new account. Please try again.');
      }
    } catch (error) {
      message(error.message || 'Account creation failed. Please try again.', 'error');
    } finally { button.disabled = false; button.textContent = 'Create account'; }
  });

  $('signOutBtn').addEventListener('click', async () => {
    try {
      const sb = await initialise();
      const { error } = await sb.auth.signOut();
      if (error) throw error;
      setUser(null);
      message('Signed out successfully.', 'success');
    } catch (error) { message(error.message || 'Could not sign out.', 'error'); }
  });
  initialise().catch(error => console.warn('Resona account setup:', error.message));
})();
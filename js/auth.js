(() => {
  const $ = (id) => document.getElementById(id);
  const dialog = $("accountDialog");
  if (!dialog) return;
  let activeUser = null;

  async function request(action, values = {}) {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action, ...values })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Account request failed.");
    return data;
  }
  function status(message, error = false) {
    $("accountStatus").textContent = message;
    $("accountStatus").classList.toggle("error", error);
  }
  function showMode(mode) {
    const login = mode === "login";
    $("loginForm").classList.toggle("hidden", !login);
    $("signupForm").classList.toggle("hidden", login);
    $("showLogin").classList.toggle("primary", login);
    $("showLogin").classList.toggle("ghost", !login);
    $("showSignup").classList.toggle("primary", !login);
    $("showSignup").classList.toggle("ghost", login);
    status("");
  }
  function renderUser(user) {
    activeUser = user;
    $("accountSignedOut").classList.toggle("hidden", !!user);
    $("accountSignedIn").classList.toggle("hidden", !user);
    $("accountBtn").textContent = user ? user.displayName : "Account";
    if (user) {
      $("accountDisplayName").textContent = user.displayName;
      $("accountEmail").textContent = user.email;
      $("profileName").value = user.displayName;
    }
  }
  async function refresh() {
    try {
      const res = await fetch("/api/auth", { credentials: "same-origin", headers: { "accept": "application/json" } });
      const data = await res.json();
      renderUser(data.user || null);
    } catch { renderUser(null); }
  }
  $("accountBtn").addEventListener("click", async () => {
    dialog.classList.remove("hidden");
    await refresh();
    if (!activeUser) showMode("login");
  });
  $("accountClose").addEventListener("click", () => dialog.classList.add("hidden"));
  dialog.addEventListener("click", e => { if (e.target === dialog) dialog.classList.add("hidden"); });
  $("showLogin").addEventListener("click", () => showMode("login"));
  $("showSignup").addEventListener("click", () => showMode("signup"));

  $("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const button = $("loginForm").querySelector('button[type="submit"]');
    button.disabled = true;
    status("Signing in…");
    try {
      const data = await request("login", {
        email: $("loginEmail").value,
        password: $("loginPassword").value
      });
      renderUser(data.user);
      status("You're signed in.");
    } catch (err) { status(err.message, true); }
    finally { button.disabled = false; }
  });

  $("signupForm").addEventListener("submit", async e => {
    e.preventDefault();
    const button = $("signupForm").querySelector('button[type="submit"]');
    button.disabled = true;
    status("Creating your account…");
    try {
      const data = await request("signup", {
        displayName: $("signupName").value,
        email: $("signupEmail").value,
        password: $("signupPassword").value
      });
      $("signupForm").reset();
      status(data.message || "Check your email to verify your account.");
    } catch (err) { status(err.message, true); }
    finally { button.disabled = false; }
  });

  $("profileForm").addEventListener("submit", async e => {
    e.preventDefault();
    try {
      const data = await request("profile", { displayName: $("profileName").value });
      renderUser(data.user);
      status("Display name updated.");
    } catch (err) { status(err.message, true); }
  });

  $("accountLogout").addEventListener("click", async () => {
    try { await request("logout"); renderUser(null); showMode("login"); status("Signed out."); }
    catch (err) { status(err.message, true); }
  });

  const params = new URLSearchParams(location.search);
  if (params.get("auth") === "verified") {
    dialog.classList.remove("hidden");
    showMode("login");
    status("Email verified! You can now sign in.");
    history.replaceState({}, "", location.pathname);
  } else if (params.get("auth") === "verification-expired") {
    dialog.classList.remove("hidden");
    showMode("signup");
    status("That verification link expired. Please create your account again.", true);
    history.replaceState({}, "", location.pathname);
  }
  refresh();
})();

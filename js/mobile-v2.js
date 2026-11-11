/* Mobile V1/V2 switch and independent mobile colour mode. */
(() => {
  const root = document.documentElement;
  const defaults = { mobileUiVersion: 'v1', mobileTheme: 'dark' };
  const readSettings = () => Object.assign({}, defaults, window.Store?.getSettings?.() || {});
  function syncControls(settings = readSettings()) {
    document.querySelectorAll('[data-mobile-ui-choice]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.mobileUiChoice === settings.mobileUiVersion));
    });
    document.querySelectorAll('[data-mobile-theme-choice]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.mobileThemeChoice === settings.mobileTheme));
    });
    const themeRow = document.getElementById('mobileV2ThemeRow');
    if (themeRow) themeRow.hidden = settings.mobileUiVersion !== 'v2';
  }
  function apply(settings = readSettings()) {
    const version = settings.mobileUiVersion === 'v2' ? 'v2' : 'v1';
    const theme = settings.mobileTheme === 'light' ? 'light' : 'dark';
    root.dataset.mobileUi = version;
    root.dataset.mobileTheme = theme;
    syncControls({ mobileUiVersion:version, mobileTheme:theme });
  }
  document.querySelectorAll('[data-mobile-ui-choice]').forEach(button => {
    button.addEventListener('click', () => {
      const settings = Store.saveSettings({ mobileUiVersion:button.dataset.mobileUiChoice });
      apply(settings);
    });
  });
  document.querySelectorAll('[data-mobile-theme-choice]').forEach(button => {
    button.addEventListener('click', () => {
      const settings = Store.saveSettings({ mobileTheme:button.dataset.mobileThemeChoice });
      apply(settings);
    });
  });
  document.getElementById('settingsBtn')?.addEventListener('click', () => syncControls());
  document.getElementById('chooseMobile')?.addEventListener('click', () => apply());
  document.getElementById('changeDeviceLayoutBtn')?.addEventListener('click', () => {
    window.setTimeout(() => syncControls(), 0);
  });
  apply();
})();

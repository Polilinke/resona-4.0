(function () {
  const STORAGE_KEY = 'deepflow-device-layout';
  const root = document.documentElement;
  const chooser = document.getElementById('deviceChoice');
  const laptopButton = document.getElementById('chooseLaptop');
  const mobileButton = document.getElementById('chooseMobile');
  const changeButton = document.getElementById('changeDeviceLayoutBtn');
  function applyLayout(layout) {
    const choice = layout === 'mobile' ? 'mobile' : 'laptop';
    root.dataset.deviceLayout = choice;
    try { localStorage.setItem(STORAGE_KEY, choice); } catch (_) {}
    if (chooser) chooser.classList.add('hidden');
  }

  function openChooser() {
    if (chooser) chooser.classList.remove('hidden');
  }

  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch (_) {}
  if (saved === 'mobile' || saved === 'laptop') {
    root.dataset.deviceLayout = saved;
  } else {
    openChooser();
  }

  if (laptopButton) laptopButton.addEventListener('click', () => applyLayout('laptop'));
  if (mobileButton) mobileButton.addEventListener('click', () => applyLayout('mobile'));
  if (changeButton) changeButton.addEventListener('click', openChooser);
})();

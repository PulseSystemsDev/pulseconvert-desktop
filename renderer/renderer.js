(function () {
  const views = {
    'signed-out': document.getElementById('view-signed-out'),
    starting: document.getElementById('view-starting'),
    'awaiting-approval': document.getElementById('view-awaiting'),
    'signed-in': document.getElementById('view-signed-in'),
    denied: document.getElementById('view-denied'),
    expired: document.getElementById('view-expired'),
    error: document.getElementById('view-error'),
  };

  let lastVerificationUrl = null;

  function render(status) {
    for (const key in views) {
      views[key].classList.toggle('hidden', key !== status.state);
    }

    if (status.state === 'awaiting-approval') {
      document.getElementById('user-code').textContent = status.userCode;
      lastVerificationUrl = status.verificationUriComplete;
      // Best-effort auto-open - the user can always use the button if the OS blocks it or they
      // dismissed the first prompt.
      window.pulseConvertDesktop.openExternal(status.verificationUriComplete);
    }

    if (status.state === 'signed-in') {
      document.getElementById('signed-in-detail').textContent = status.discordId
        ? `This device is linked to your Pulse account.`
        : 'This device is linked to your Pulse account.';
    }

    if (status.state === 'error') {
      document.getElementById('error-message').textContent = status.message;
    }
  }

  document.getElementById('btn-sign-in').addEventListener('click', () => window.pulseConvertDesktop.startSignIn());
  document.getElementById('btn-retry-denied').addEventListener('click', () => window.pulseConvertDesktop.startSignIn());
  document.getElementById('btn-retry-expired').addEventListener('click', () => window.pulseConvertDesktop.startSignIn());
  document.getElementById('btn-retry-error').addEventListener('click', () => window.pulseConvertDesktop.startSignIn());
  document.getElementById('btn-cancel').addEventListener('click', () => window.pulseConvertDesktop.cancelSignIn());
  document.getElementById('btn-sign-out').addEventListener('click', () => window.pulseConvertDesktop.signOut());
  document.getElementById('btn-open-browser').addEventListener('click', () => {
    if (lastVerificationUrl) window.pulseConvertDesktop.openExternal(lastVerificationUrl);
  });

  window.pulseConvertDesktop.onAuthStatusChange(render);
  window.pulseConvertDesktop.getAuthStatus().then(render);

  // --- Convert ---

  const convertProgressEl = document.getElementById('convert-progress');
  const convertResultEl = document.getElementById('convert-result');
  const convertErrorEl = document.getElementById('convert-error');
  const convertUrlInput = document.getElementById('convert-url');
  const btnConvert = document.getElementById('btn-convert');
  let lastOutputPath = null;

  function resetConvertPanels() {
    convertProgressEl.classList.add('hidden');
    convertResultEl.classList.add('hidden');
    convertErrorEl.classList.add('hidden');
  }

  window.pulseConvertDesktop.onConvertProgress((label) => {
    document.getElementById('convert-progress-label').textContent = label;
  });

  btnConvert.addEventListener('click', async () => {
    const url = convertUrlInput.value.trim();
    if (!url) return;

    resetConvertPanels();
    convertProgressEl.classList.remove('hidden');
    btnConvert.disabled = true;

    const outcome = await window.pulseConvertDesktop.startConvert(url);

    convertProgressEl.classList.add('hidden');
    btnConvert.disabled = false;

    if (outcome.ok && outcome.result) {
      lastOutputPath = outcome.result.outputZipPath;
      let label = outcome.result.fromCache
        ? `Downloaded "${outcome.result.resourceName}" (already in the catalog).`
        : `Converted "${outcome.result.resourceName}" (${outcome.result.fixLog.length} fix${outcome.result.fixLog.length === 1 ? '' : 'es'} applied).`;
      const deploy = outcome.result.deploy;
      if (deploy && deploy.deployed) {
        label += ` Deployed to ${deploy.mode === 'local' ? deploy.destination : deploy.mode.toUpperCase()}.`;
      } else if (deploy && deploy.mode !== 'none' && deploy.error) {
        label += ` Deploy failed: ${deploy.error}`;
      }
      document.getElementById('convert-result-label').textContent = label;
      convertResultEl.classList.remove('hidden');
    } else {
      document.getElementById('convert-error-label').textContent = outcome.error || 'Conversion failed.';
      convertErrorEl.classList.remove('hidden');
    }
  });

  document.getElementById('btn-show-in-folder').addEventListener('click', () => {
    if (lastOutputPath) window.pulseConvertDesktop.showInFolder(lastOutputPath);
  });

  // --- Settings ---

  const viewSettings = document.getElementById('view-settings');
  const viewSignedIn = document.getElementById('view-signed-in');
  const deployModeSelect = document.getElementById('deploy-mode');
  const localFieldsEl = document.getElementById('local-fields');
  const sftpFieldsEl = document.getElementById('sftp-fields');

  function updateFieldVisibility() {
    const mode = deployModeSelect.value;
    localFieldsEl.classList.toggle('hidden', mode !== 'local');
    sftpFieldsEl.classList.toggle('hidden', mode !== 'sftp');
  }
  deployModeSelect.addEventListener('change', updateFieldVisibility);

  document.getElementById('btn-settings').addEventListener('click', async () => {
    const settings = await window.pulseConvertDesktop.getSettings();
    deployModeSelect.value = settings.deployMode;
    document.getElementById('local-folder').value = settings.localDeployFolder || '';
    document.getElementById('sftp-host').value = settings.sftpHost || '';
    document.getElementById('sftp-port').value = String(settings.sftpPort || 22);
    document.getElementById('sftp-username').value = settings.sftpUsername || '';
    document.getElementById('sftp-remote-path').value = settings.sftpRemotePath || '';
    document.getElementById('sftp-password').value = '';
    updateFieldVisibility();
    viewSignedIn.classList.add('hidden');
    viewSettings.classList.remove('hidden');
  });

  document.getElementById('btn-close-settings').addEventListener('click', () => {
    viewSettings.classList.add('hidden');
    viewSignedIn.classList.remove('hidden');
  });

  document.getElementById('btn-choose-folder').addEventListener('click', async () => {
    const folder = await window.pulseConvertDesktop.chooseFolder();
    if (folder) document.getElementById('local-folder').value = folder;
  });

  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    const port = parseInt(document.getElementById('sftp-port').value, 10);
    await window.pulseConvertDesktop.saveSettings({
      deployMode: deployModeSelect.value,
      localDeployFolder: document.getElementById('local-folder').value || null,
      sftpHost: document.getElementById('sftp-host').value || null,
      sftpPort: Number.isFinite(port) && port > 0 ? port : 22,
      sftpUsername: document.getElementById('sftp-username').value || null,
      sftpRemotePath: document.getElementById('sftp-remote-path').value || null,
      sftpPassword: document.getElementById('sftp-password').value || undefined,
    });
    viewSettings.classList.add('hidden');
    viewSignedIn.classList.remove('hidden');
  });
})();

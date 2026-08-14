(function () {
  'use strict';

  const api = window.pulseConvertDesktop;
  const HISTORY_KEY = 'pulseconvert.desktop.runs.v2';
  const MAX_HISTORY = 20;
  const state = {
    authenticated: false,
    route: 'optimize',
    source: null,
    settings: null,
    readiness: null,
    history: readHistory(),
    busyOperation: null,
    verificationUrl: null,
    optimizeOutputPath: null,
    convertOutputPath: null,
  };

  const el = (id) => document.getElementById(id);
  const appShell = el('app-shell');
  const authView = el('auth-view');
  const dataViews = Array.from(document.querySelectorAll('[data-view]'));
  const routeButtons = Array.from(document.querySelectorAll('.dock-button[data-route]'));

  function readHistory() {
    try {
      const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter(isHistoryItem).slice(0, MAX_HISTORY) : [];
    } catch {
      return [];
    }
  }

  function isHistoryItem(value) {
    return Boolean(value && typeof value === 'object' && typeof value.name === 'string' && typeof value.completedAt === 'string');
  }

  function writeHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(0, MAX_HISTORY)));
    } catch {
      // A run remains usable even if local history storage is unavailable.
    }
  }

  function addHistory(item) {
    state.history.unshift(item);
    state.history = state.history.slice(0, MAX_HISTORY);
    writeHistory();
    renderHistory();
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown';
    if (bytes === 0) return '0 B';
    const units = ['B', 'KiB', 'MiB', 'GiB'];
    const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, unitIndex);
    return `${value >= 100 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Completed previously';
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }

  function labelForInputKind(kind) {
    return ({ archive: 'Resource archive', file: 'Standalone stream file', folder: 'Resource folder' })[kind] || 'Local resource';
  }

  function selectedValue(name) {
    const input = document.querySelector(`input[name="${name}"]:checked`);
    return input ? input.value : '';
  }

  function setText(target, text) {
    const node = typeof target === 'string' ? el(target) : target;
    if (node) node.textContent = text == null ? '' : String(text);
  }

  function setIcon(target, iconName) {
    const node = typeof target === 'string' ? el(target) : target;
    if (!node) return;
    node.replaceChildren();
    const icon = document.createElement('i');
    icon.className = `ph ph-${iconName}`;
    icon.setAttribute('aria-hidden', 'true');
    node.appendChild(icon);
  }

  function showToast(message, type) {
    const toast = document.createElement('div');
    toast.className = `toast${type === 'error' ? ' is-error' : ''}`;
    toast.textContent = message;
    el('toast-region').appendChild(toast);
    window.setTimeout(() => toast.remove(), 4200);
  }

  function setRoute(route) {
    if (!state.authenticated) return;
    state.route = route;
    authView.classList.add('hidden');
    for (const view of dataViews) view.classList.toggle('hidden', view.dataset.view !== route);
    for (const button of routeButtons) {
      const active = button.dataset.route === route;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    const context = ({
      optimize: 'Optimization workspace',
      convert: 'Conversion workspace',
      history: 'Run history',
      deploy: 'Deployment',
      settings: 'System settings',
      about: 'About',
    })[route] || 'Local workstation';
    setText('titlebar-context', context);
    if (route === 'history') renderHistory();
    if (route === 'settings' || route === 'deploy') void loadSettings();
    if (route === 'settings' || route === 'optimize') void loadReadiness();
  }

  function renderAuth(status) {
    const signedIn = status && status.state === 'signed-in';
    state.authenticated = signedIn;
    appShell.dataset.authenticated = String(signedIn);
    el('account-chip').classList.toggle('is-online', signedIn);
    setText('account-label', signedIn ? 'Pulse connected' : 'Signed out');

    if (signedIn) {
      authView.classList.add('hidden');
      setRoute(state.route);
      return;
    }

    for (const view of dataViews) view.classList.add('hidden');
    authView.classList.remove('hidden');
    setText('titlebar-context', 'Local workstation');

    const signInButton = el('btn-sign-in');
    const openButton = el('btn-open-browser');
    const cancelButton = el('btn-cancel-sign-in');
    const codeWrap = el('auth-code-wrap');
    signInButton.classList.remove('hidden');
    openButton.classList.add('hidden');
    cancelButton.classList.add('hidden');
    codeWrap.classList.add('hidden');
    signInButton.disabled = false;
    setText(signInButton.querySelector('span'), 'Sign in with Pulse');

    const current = status && status.state ? status.state : 'signed-out';
    if (current === 'starting') {
      setText('auth-title', 'Starting secure sign-in.');
      setText('auth-message', 'Requesting a device code from Pulse Accounts.');
      signInButton.disabled = true;
      setText(signInButton.querySelector('span'), 'Starting sign-in');
      cancelButton.classList.remove('hidden');
    } else if (current === 'awaiting-approval') {
      setText('auth-title', 'Link this workstation.');
      setText('auth-message', 'Approve the device in your browser, then return here.');
      state.verificationUrl = status.verificationUriComplete || status.verificationUri || null;
      setText('auth-code', status.userCode || 'Code unavailable');
      codeWrap.classList.remove('hidden');
      signInButton.classList.add('hidden');
      openButton.classList.toggle('hidden', !state.verificationUrl);
      cancelButton.classList.remove('hidden');
    } else if (current === 'denied') {
      setText('auth-title', 'Sign-in was denied.');
      setText('auth-message', 'No account was linked. You can start a new request when ready.');
      setText(signInButton.querySelector('span'), 'Try sign-in again');
    } else if (current === 'expired') {
      setText('auth-title', 'The device code expired.');
      setText('auth-message', 'Start again to receive a fresh code.');
      setText(signInButton.querySelector('span'), 'Get a new code');
    } else if (current === 'error') {
      setText('auth-title', 'Pulse Accounts could not be reached.');
      setText('auth-message', status.message || 'Check the connection and try again.');
      setText(signInButton.querySelector('span'), 'Try again');
    } else {
      setText('auth-title', 'Run Pulse Convert on your machine.');
      setText('auth-message', 'Sign in to resolve supported mod links, receive dashboard jobs, and keep processing local.');
    }
  }

  async function chooseSource(kind) {
    if (!api || typeof api.chooseInput !== 'function') return showToast('The desktop file picker is unavailable.', 'error');
    try {
      const source = await api.chooseInput(kind);
      if (!source) return;
      state.source = source;
      state.optimizeOutputPath = null;
      renderSource();
      resetOptimizeResult();
    } catch (error) {
      showToast(error.message || 'The source could not be opened.', 'error');
    }
  }

  function renderSource() {
    const source = state.source;
    el('source-picker').classList.toggle('hidden', Boolean(source));
    el('selected-source').classList.toggle('hidden', !source);
    if (source) {
      setText('selected-source-name', source.name || 'Selected resource');
      setText('selected-source-kind', labelForInputKind(source.inputKind));
      setText('selected-source-path', source.inputPath);
      setText('preflight-name', source.name || 'Selected resource');
      setText('preflight-kind', labelForInputKind(source.inputKind));
      setText('preflight-size', source.sizeBytes == null ? 'Calculated during run' : formatBytes(source.sizeBytes));
    } else {
      setText('preflight-name', 'No source selected');
      setText('preflight-kind', 'Unknown');
      setText('preflight-size', 'Unknown');
    }
    renderOptimizePlan();
    updateOptimizeAction();
    renderProcessPath();
  }

  function renderProcessPath(stage) {
    const stages = ['source', 'category', 'optimize', 'review', 'deploy'];
    const hasSource = Boolean(state.source);
    const hasPlan = hasSource && Boolean(selectedValue('optimize-category')) && Boolean(selectedValue('optimize-quality'));
    const active = stage || (!hasSource ? 'source' : state.optimizeOutputPath ? 'review' : hasPlan ? 'optimize' : 'category');
    const activeIndex = stages.indexOf(active);
    for (const item of document.querySelectorAll('.process-path li')) {
      const index = stages.indexOf(item.dataset.stage);
      const complete = item.dataset.stage === 'source'
        ? hasSource
        : item.dataset.stage === 'category'
          ? hasPlan
          : item.dataset.stage === 'optimize'
            ? Boolean(state.optimizeOutputPath)
            : index < activeIndex && Boolean(state.optimizeOutputPath);
      item.classList.toggle('is-active', index === activeIndex);
      item.classList.toggle('is-complete', complete && index !== activeIndex);
    }
  }

  function renderOptimizePlan() {
    const category = selectedValue('optimize-category') || 'vehicles';
    const quality = selectedValue('optimize-quality') || 'performance';
    const maxTextureSize = ({ balanced: 2048, performance: 1024, aggressive: 512 })[quality];
    const steps = [
      `Split texture dictionaries above the 15 MiB stream target and preserve their relationships.`,
      `Optimize YTD textures progressively up to a ${maxTextureSize} px cap.`,
    ];
    if (category === 'vehicles') steps.push('Re-check vehicle metadata before bundling.');
    if (category !== 'textures') steps.push('Run the Blender pass for textures embedded in model files when Blender is available.');
    steps.push('Rescan streamed assets and report any remaining oversized YTD files.');
    steps.push('Write a separate optimized resource ZIP without changing the source.');
    renderPlanList(el('optimization-plan'), steps);
  }

  function renderConversionPlan() {
    const profile = selectedValue('convert-profile') || 'preserve';
    const target = selectedValue('convert-target') || 'addon';
    const steps = [
      'Resolve the supported link and reuse an exact matching catalog build when one exists.',
      profile === 'performance'
        ? 'Apply compatibility fixes, optimize every YTD, and check embedded model textures.'
        : 'Apply compatibility fixes while preserving the source texture profile.',
      target === 'addon'
        ? 'Build an add-on resource that can live alongside existing vehicles.'
        : 'Build a replacement resource for the matching base-game vehicle.',
      'Write the completed ZIP locally, then run the configured deployment if enabled.',
    ];
    renderPlanList(el('conversion-plan'), steps);
  }

  function renderPlanList(list, steps) {
    list.replaceChildren();
    for (const text of steps) {
      const item = document.createElement('li');
      const icon = document.createElement('i');
      icon.className = 'ph ph-check';
      icon.setAttribute('aria-hidden', 'true');
      const copy = document.createElement('span');
      copy.textContent = text;
      item.append(icon, copy);
      list.appendChild(item);
    }
  }

  async function loadSettings() {
    if (!api || typeof api.getSettings !== 'function') return;
    try {
      state.settings = await api.getSettings();
      renderSettings();
    } catch (error) {
      showToast(error.message || 'Settings could not be loaded.', 'error');
    }
  }

  function renderSettings() {
    const settings = state.settings;
    if (!settings) return;
    el('deploy-mode').value = settings.deployMode || 'none';
    el('local-folder').value = settings.localDeployFolder || '';
    el('sftp-host').value = settings.sftpHost || '';
    el('sftp-port').value = String(settings.sftpPort || 22);
    el('sftp-username').value = settings.sftpUsername || '';
    el('sftp-remote-path').value = settings.sftpRemotePath || '';
    el('sftp-password').value = '';
    if (el('sftp-clear-password')) el('sftp-clear-password').checked = false;
    el('output-folder').value = settings.outputFolder || '';
    el('rpf-tool-path').value = settings.rpfToolPath || '';
    el('blender-path').value = settings.blenderPath || '';
    el('sevenzip-path').value = settings.sevenZipPath || '';
    const output = settings.outputFolder || 'Not configured';
    setText('optimize-output-path', output);
    setText('convert-output-path', output);
    setText('preflight-output', output);
    updateDeployFields();
    renderConversionPlan();
  }

  async function loadReadiness() {
    if (!api || typeof api.getSystemReadiness !== 'function') return;
    const pill = el('readiness-pill');
    setText(pill, 'Checking tools');
    try {
      state.readiness = await api.getSystemReadiness();
      renderReadiness();
    } catch (error) {
      state.readiness = null;
      setText(pill, 'Readiness check failed');
      showToast(error.message || 'Native tools could not be checked.', 'error');
      updateOptimizeAction();
    }
  }

  function renderReadiness() {
    const readiness = state.readiness;
    if (!readiness) return;
    const pill = el('readiness-pill');
    setText(pill, readiness.ready ? 'Ready to process' : 'Setup required');
    setText('optimize-output-path', readiness.outputFolder || 'Not configured');
    setText('convert-output-path', readiness.outputFolder || 'Not configured');
    setText('preflight-output', readiness.outputFolder || 'Not configured');

    const labels = { rpfTool: 'RPF tool', blender: 'Blender', sevenZip: '7-Zip' };
    const icons = { rpfTool: 'cube', blender: 'cube-focus', sevenZip: 'file-zip' };
    const toolList = el('tool-list');
    const readinessCards = el('settings-readiness');
    toolList.replaceChildren();
    readinessCards.replaceChildren();

    for (const key of ['rpfTool', 'blender', 'sevenZip']) {
      const tool = readiness.tools && readiness.tools[key] ? readiness.tools[key] : { available: false, path: null, detail: 'No status was returned.' };
      const row = document.createElement('li');
      const name = document.createElement('span');
      const status = document.createElement('span');
      name.textContent = labels[key];
      status.className = `status-text ${tool.available ? 'is-ready' : 'is-missing'}`;
      status.textContent = tool.available ? 'Available' : tool.required ? 'Required' : 'Unavailable';
      row.append(name, status);
      toolList.appendChild(row);

      const card = document.createElement('article');
      card.className = `readiness-card ${tool.available ? 'is-ready' : 'is-missing'}`;
      const icon = document.createElement('i');
      icon.className = `ph ph-${icons[key]}`;
      icon.setAttribute('aria-hidden', 'true');
      const copy = document.createElement('div');
      const heading = document.createElement('strong');
      const detail = document.createElement('span');
      const path = document.createElement('code');
      heading.textContent = labels[key];
      detail.textContent = tool.detail || (tool.available ? 'Ready.' : 'Not available.');
      path.textContent = tool.path || 'No path resolved';
      copy.append(heading, detail, path);
      card.append(icon, copy);
      readinessCards.appendChild(card);
    }
    updateOptimizeAction();
  }

  function updateOptimizeAction() {
    const button = el('btn-optimize');
    if (state.busyOperation) {
      button.disabled = true;
      setText(button.querySelector('span'), state.busyOperation === 'optimize' ? 'Optimizing resource' : 'Another run is active');
      return;
    }
    if (!state.source) {
      button.disabled = true;
      setText(button.querySelector('span'), 'Choose a source');
      return;
    }
    if (!state.readiness) {
      button.disabled = true;
      setText(button.querySelector('span'), 'Checking tools');
      return;
    }
    const needsSevenZip = state.source.inputKind === 'archive' && /\.(rar|7z)$/i.test(state.source.inputPath || '');
    if (!state.readiness.ready || (needsSevenZip && !state.readiness.tools.sevenZip.available)) {
      button.disabled = true;
      setText(button.querySelector('span'), 'Resolve tool setup');
      return;
    }
    button.disabled = false;
    setText(button.querySelector('span'), state.optimizeOutputPath ? 'Optimize again' : 'Optimize resource');
  }

  function updateAllActions() {
    updateOptimizeAction();
    const convertButton = el('btn-convert');
    convertButton.disabled = Boolean(state.busyOperation);
    setText(convertButton.querySelector('span'), state.busyOperation === 'convert' ? 'Converting resource' : 'Convert resource');
  }

  function beginRun(kind, label) {
    state.busyOperation = kind;
    updateAllActions();
    const runState = el(`${kind}-run-state`);
    runState.classList.remove('hidden', 'is-success', 'is-error');
    setIcon(`${kind}-state-icon`, 'spinner-gap');
    setText(`${kind}-state-title`, kind === 'optimize' ? 'Optimizing resource' : 'Converting mod');
    setText(`${kind}-progress-label`, label);
    const bar = el(`${kind}-progress-bar`);
    bar.removeAttribute('style');
    if (kind === 'optimize') {
      setText('optimize-progress-count', '');
      el('optimize-result-metrics').classList.add('hidden');
      el('optimize-fix-log').classList.add('hidden');
      el('btn-show-optimize-output').classList.add('hidden');
      renderProcessPath('optimize');
    } else {
      el('convert-fix-log').classList.add('hidden');
      el('btn-show-convert-output').classList.add('hidden');
    }
  }

  function finishRun(kind) {
    state.busyOperation = null;
    updateAllActions();
    const bar = el(`${kind}-progress-bar`);
    bar.style.width = '100%';
  }

  function failRun(kind, message) {
    finishRun(kind);
    const runState = el(`${kind}-run-state`);
    runState.classList.add('is-error');
    setIcon(`${kind}-state-icon`, 'x');
    setText(`${kind}-state-title`, kind === 'optimize' ? 'Optimization failed' : 'Conversion failed');
    setText(`${kind}-progress-label`, message || 'The operation did not complete.');
    showToast(message || 'The operation did not complete.', 'error');
  }

  function resetOptimizeResult() {
    state.optimizeOutputPath = null;
    el('optimize-run-state').classList.add('hidden');
    el('btn-show-optimize-output').classList.add('hidden');
    renderProcessPath();
    updateOptimizeAction();
  }

  async function runOptimize() {
    if (!state.source || state.busyOperation || !api || typeof api.startOptimize !== 'function') return;
    const category = selectedValue('optimize-category');
    const quality = selectedValue('optimize-quality');
    beginRun('optimize', 'Preparing a safe working copy');
    try {
      const outcome = await api.startOptimize({
        inputPath: state.source.inputPath,
        inputKind: state.source.inputKind,
        category,
        quality,
      });
      if (!outcome || !outcome.ok || !outcome.result) throw new Error((outcome && outcome.error) || 'Optimization failed.');
      const result = outcome.result;
      state.optimizeOutputPath = result.outputZipPath;
      finishRun('optimize');
      const runState = el('optimize-run-state');
      runState.classList.add('is-success');
      setIcon('optimize-state-icon', 'check');
      setText('optimize-state-title', 'Optimized ZIP is ready');
      const remaining = Array.isArray(result.oversizedYtd) ? result.oversizedYtd.length : 0;
      setText('optimize-progress-label', remaining > 0
        ? `${remaining} oversized texture ${remaining === 1 ? 'dictionary remains' : 'dictionaries remain'} for review.`
        : 'The source was preserved and the new ZIP passed its post-run scan.');
      setText('optimize-progress-count', 'Complete');
      renderOptimizeMetrics(result);
      renderFixLog('optimize', result.fixLog || []);
      el('btn-show-optimize-output').classList.remove('hidden');
      renderProcessPath('review');
      addHistory({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'optimize',
        name: result.resourceName || state.source.name,
        completedAt: new Date().toISOString(),
        outputPath: result.outputZipPath,
        beforeBytes: result.beforeBytes,
        afterBytes: result.afterBytes,
        reductionPercent: result.reductionPercent,
        optimizedCount: result.optimizedCount,
        category: result.category || category,
        quality: result.quality || quality,
      });
    } catch (error) {
      failRun('optimize', error.message || 'Optimization failed.');
    }
  }

  function renderOptimizeMetrics(result) {
    const metrics = [
      ['Before', formatBytes(result.beforeBytes)],
      ['After', formatBytes(result.afterBytes)],
      ['Saved', result.reductionPercent > 0 ? `${formatBytes(result.savedBytes)} (${result.reductionPercent}%)` : formatBytes(result.savedBytes), true],
      ['Files optimized', String(result.optimizedCount || 0)],
    ];
    const container = el('optimize-result-metrics');
    container.replaceChildren();
    for (const [label, value, positive] of metrics) {
      const metric = document.createElement('div');
      metric.className = `metric${positive ? ' is-positive' : ''}`;
      const name = document.createElement('span');
      const resultValue = document.createElement('strong');
      name.textContent = label;
      resultValue.textContent = value;
      metric.append(name, resultValue);
      container.appendChild(metric);
    }
    container.classList.remove('hidden');
  }

  function renderFixLog(kind, entries) {
    const details = el(`${kind}-fix-log`);
    const list = el(kind === 'optimize' ? 'fix-log-list' : 'convert-fix-list');
    const count = el(kind === 'optimize' ? 'fix-log-count' : 'convert-fix-count');
    list.replaceChildren();
    for (const entry of entries) {
      const item = document.createElement('li');
      item.textContent = entry;
      list.appendChild(item);
    }
    setText(count, `(${entries.length})`);
    details.classList.toggle('hidden', entries.length === 0);
  }

  async function runConvert() {
    if (state.busyOperation || !api || typeof api.startConvert !== 'function') return;
    const url = el('convert-url').value.trim();
    if (!url) {
      el('convert-url').focus();
      return showToast('Enter a supported mod URL first.', 'error');
    }
    const profile = selectedValue('convert-profile');
    const target = selectedValue('convert-target');
    beginRun('convert', 'Checking the catalog');
    try {
      const outcome = await api.startConvert({ url, profile, target });
      if (!outcome || !outcome.ok || !outcome.result) throw new Error((outcome && outcome.error) || 'Conversion failed.');
      const result = outcome.result;
      state.convertOutputPath = result.outputZipPath;
      finishRun('convert');
      const runState = el('convert-run-state');
      runState.classList.add('is-success');
      setIcon('convert-state-icon', 'check');
      setText('convert-state-title', result.fromCache ? 'Catalog ZIP is ready' : 'Converted ZIP is ready');
      const deploy = result.deploy;
      let summary = result.fromCache ? 'An exact catalog build was downloaded.' : 'The resource was converted on this machine.';
      if (deploy && deploy.deployed) summary += ` Deployment completed to ${deploy.destination || deploy.mode}.`;
      if (deploy && deploy.error) summary += ` Deployment did not complete: ${deploy.error}`;
      setText('convert-progress-label', summary);
      renderFixLog('convert', result.fixLog || []);
      el('btn-show-convert-output').classList.remove('hidden');
      addHistory({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'convert',
        name: result.resourceName || 'Converted resource',
        completedAt: new Date().toISOString(),
        outputPath: result.outputZipPath,
        fromCache: Boolean(result.fromCache),
        fixCount: Array.isArray(result.fixLog) ? result.fixLog.length : 0,
        profile,
        target,
      });
    } catch (error) {
      failRun('convert', error.message || 'Conversion failed.');
    }
  }

  function handleProgress(value) {
    const progress = typeof value === 'string' ? { operation: state.busyOperation || 'convert', label: value } : value;
    if (!progress || !progress.label) return;
    if (progress.operation === 'convert' || progress.operation === 'optimize') {
      const kind = progress.operation;
      setText(`${kind}-progress-label`, progress.label);
      const total = Number(progress.total);
      const current = Number(progress.current);
      if (kind === 'optimize') setText('optimize-progress-count', Number.isFinite(total) && total > 0 ? `${current || 0} / ${total}` : '');
      if (Number.isFinite(total) && total > 0 && Number.isFinite(current)) {
        el(`${kind}-progress-bar`).style.width = `${Math.max(4, Math.min(100, (current / total) * 100))}%`;
      }
    } else if (progress.operation === 'remote-convert' || progress.operation === 'remote-optimize') {
      el('account-chip').classList.add('is-online');
      setText('account-label', progress.label);
    }
  }

  function updateDeployFields() {
    const mode = el('deploy-mode').value;
    el('local-deploy-fields').classList.toggle('hidden', mode !== 'local');
    el('sftp-deploy-fields').classList.toggle('hidden', mode !== 'sftp');
  }

  async function saveDeploySettings() {
    if (!api || typeof api.saveSettings !== 'function') return;
    const port = Number.parseInt(el('sftp-port').value, 10);
    const password = el('sftp-password').value;
    const clearPassword = el('sftp-clear-password') && el('sftp-clear-password').checked;
    const payload = {
      deployMode: el('deploy-mode').value,
      localDeployFolder: el('local-folder').value || null,
      sftpHost: el('sftp-host').value || null,
      sftpPort: Number.isInteger(port) ? port : 22,
      sftpUsername: el('sftp-username').value || null,
      sftpRemotePath: el('sftp-remote-path').value || null,
    };
    if (clearPassword) payload.sftpPassword = '';
    else if (password.length > 0) payload.sftpPassword = password;
    await saveSettingsPayload(payload, 'deploy-save-feedback', 'Deployment settings saved.');
  }

  async function saveToolSettings() {
    if (!api || typeof api.saveSettings !== 'function') return;
    const payload = {
      outputFolder: el('output-folder').value || null,
      rpfToolPath: el('rpf-tool-path').value || null,
      blenderPath: el('blender-path').value || null,
      sevenZipPath: el('sevenzip-path').value || null,
    };
    const saved = await saveSettingsPayload(payload, 'settings-save-feedback', 'Output and tool settings saved.');
    if (saved) await loadReadiness();
  }

  async function saveSettingsPayload(payload, feedbackId, successMessage) {
    const feedback = el(feedbackId);
    feedback.className = 'save-feedback';
    setText(feedback, 'Saving settings');
    try {
      const outcome = await api.saveSettings(payload);
      if (!outcome || !outcome.ok) throw new Error((outcome && outcome.error) || 'Settings were not saved.');
      feedback.classList.add('is-success');
      setText(feedback, successMessage);
      await loadSettings();
      return true;
    } catch (error) {
      feedback.classList.add('is-error');
      setText(feedback, error.message || 'Settings were not saved.');
      return false;
    }
  }

  async function chooseSettingsFolder(inputId) {
    if (!api || typeof api.chooseFolder !== 'function') return;
    try {
      const folder = await api.chooseFolder();
      if (folder) el(inputId).value = folder;
    } catch (error) {
      showToast(error.message || 'The folder could not be selected.', 'error');
    }
  }

  function renderHistory() {
    const recentList = el('recent-list');
    const historyList = el('history-list');
    recentList.replaceChildren();
    historyList.replaceChildren();
    const hasRuns = state.history.length > 0;
    el('recent-empty').classList.toggle('hidden', hasRuns);
    recentList.classList.toggle('hidden', !hasRuns);
    el('btn-view-all-runs').classList.toggle('hidden', !hasRuns);
    el('history-empty').classList.toggle('hidden', hasRuns);
    historyList.classList.toggle('hidden', !hasRuns);

    for (const item of state.history.slice(0, 5)) recentList.appendChild(createRecentRow(item));
    for (const item of state.history) historyList.appendChild(createHistoryRow(item));
  }

  function createRecentRow(item) {
    const row = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'recent-button';
    button.addEventListener('click', () => setRoute('history'));
    const icon = document.createElement('i');
    icon.className = `ph ph-${item.type === 'optimize' ? 'stack-simple' : 'arrows-clockwise'}`;
    icon.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    const name = document.createElement('strong');
    const date = document.createElement('small');
    name.textContent = item.name;
    date.textContent = formatDate(item.completedAt);
    copy.append(name, date);
    const status = document.createElement('i');
    status.className = 'ph ph-check-circle';
    status.setAttribute('aria-hidden', 'true');
    button.append(icon, copy, status);
    row.appendChild(button);
    return row;
  }

  function createHistoryRow(item) {
    const row = document.createElement('li');
    row.className = 'history-row';
    const icon = document.createElement('i');
    icon.className = `ph ph-${item.type === 'optimize' ? 'stack-simple' : 'arrows-clockwise'}`;
    icon.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div');
    copy.className = 'history-row-copy';
    const name = document.createElement('strong');
    const detail = document.createElement('span');
    const path = document.createElement('code');
    name.textContent = item.name;
    detail.textContent = item.type === 'optimize'
      ? `${item.category || 'Resource'} optimization, ${item.quality || 'default'} preset`
      : `${item.profile || 'Preserve'} profile, ${item.target || 'add-on'} target`;
    path.textContent = item.outputPath || 'Output path unavailable';
    copy.append(name, detail, path);
    const completed = document.createElement('div');
    completed.className = 'history-stat';
    const completedLabel = document.createElement('span');
    const completedValue = document.createElement('strong');
    completedLabel.textContent = 'Completed';
    completedValue.textContent = formatDate(item.completedAt);
    completed.append(completedLabel, completedValue);
    const result = document.createElement('div');
    result.className = 'history-stat';
    const resultLabel = document.createElement('span');
    const resultValue = document.createElement('strong');
    resultLabel.textContent = item.type === 'optimize' ? 'Result' : 'Fixes';
    resultValue.textContent = item.type === 'optimize'
      ? `${formatBytes(item.afterBytes)}${item.reductionPercent > 0 ? `, ${item.reductionPercent}% saved` : ''}`
      : String(item.fixCount || 0);
    result.append(resultLabel, resultValue);
    row.append(icon, copy, completed, result);
    return row;
  }

  function bindEvents() {
    for (const button of routeButtons) button.addEventListener('click', () => setRoute(button.dataset.route));
    el('btn-view-all-runs').addEventListener('click', () => setRoute('history'));
    el('btn-source-file').addEventListener('click', () => void chooseSource('archive-or-file'));
    el('btn-choose-archive').addEventListener('click', () => void chooseSource('archive-or-file'));
    el('btn-source-folder').addEventListener('click', () => void chooseSource('folder'));
    el('btn-clear-source').addEventListener('click', () => { state.source = null; renderSource(); resetOptimizeResult(); });

    for (const input of document.querySelectorAll('input[name="optimize-category"], input[name="optimize-quality"]')) {
      input.addEventListener('change', () => { renderOptimizePlan(); resetOptimizeResult(); });
    }
    for (const input of document.querySelectorAll('input[name="convert-profile"], input[name="convert-target"]')) {
      input.addEventListener('change', renderConversionPlan);
    }

    el('btn-optimize').addEventListener('click', () => void runOptimize());
    el('btn-convert').addEventListener('click', () => void runConvert());
    el('convert-url').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); void runConvert(); }
    });
    el('btn-show-optimize-output').addEventListener('click', () => {
      if (state.optimizeOutputPath && api) api.showInFolder(state.optimizeOutputPath);
    });
    el('btn-show-convert-output').addEventListener('click', () => {
      if (state.convertOutputPath && api) api.showInFolder(state.convertOutputPath);
    });

    el('deploy-mode').addEventListener('change', updateDeployFields);
    el('btn-choose-local-folder').addEventListener('click', () => void chooseSettingsFolder('local-folder'));
    el('btn-choose-output-folder').addEventListener('click', () => void chooseSettingsFolder('output-folder'));
    el('btn-save-deploy').addEventListener('click', () => void saveDeploySettings());
    el('btn-save-settings').addEventListener('click', () => void saveToolSettings());
    el('btn-refresh-readiness').addEventListener('click', () => void loadReadiness());

    el('btn-clear-history').addEventListener('click', () => {
      state.history = [];
      writeHistory();
      renderHistory();
      showToast('Run history cleared.');
    });

    el('btn-sign-in').addEventListener('click', () => { if (api) api.startSignIn(); });
    el('btn-open-browser').addEventListener('click', () => { if (api && state.verificationUrl) api.openExternal(state.verificationUrl); });
    el('btn-cancel-sign-in').addEventListener('click', () => { if (api) api.cancelSignIn(); });
    el('btn-sign-out').addEventListener('click', () => { if (api) api.signOut(); });
  }

  function initializeBridge() {
    setText('app-version', api && api.version ? api.version : 'Unavailable');
    setText('app-platform', api && api.platform ? api.platform : 'Unavailable');
    if (!api) {
      renderAuth({ state: 'error', message: 'The secure desktop bridge is unavailable. Restart the desktop application.' });
      el('btn-sign-in').disabled = true;
      return;
    }
    if (typeof api.onAuthStatusChange === 'function') api.onAuthStatusChange(renderAuth);
    if (typeof api.onConvertProgress === 'function') api.onConvertProgress(handleProgress);
    Promise.resolve(api.getAuthStatus())
      .then(renderAuth)
      .catch((error) => renderAuth({ state: 'error', message: error.message || 'Authentication status is unavailable.' }));
    void loadSettings();
    void loadReadiness();
  }

  bindEvents();
  renderSource();
  renderHistory();
  renderOptimizePlan();
  renderConversionPlan();
  initializeBridge();
})();

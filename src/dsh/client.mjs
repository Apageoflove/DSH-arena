/** DSH Arena browser half, hand-written in the lazy-CJS bundle protocol
 * (window.__ModuleLoader__.load with a factory returning cordis-plugin
 * exports), so the web shell can register and materialize it. */

/** UI strings for both locales; zh is the default, en keeps the classic text. */
const I18N = {
  zh: {
    launcher: '实验台',
    brand: 'DSH 实验台',
    status: '本地优先的评估工作台',
    importReport: '导入报告',
    importAria: '导入 DSH Arena JSON 报告',
    chooseFile: '选择 DSH Arena 报告 JSON',
    closeAria: '关闭 DSH 实验台',
    toggle: 'EN',
    toggleAria: '切换为英文',
    execOn: '执行：开',
    execOff: '执行：关',
    execAria: '切换实验执行开关（关闭后运行器拒绝跑，不消耗 token）',
    candTitle: '竞赛模型',
    candHint: '关闭的模型不参与实验，不消耗 token；可在此添加或移除',
    candOn: '开',
    candOff: '关',
    candAdd: '添加',
    candAddAria: '添加竞赛模型',
    candPlaceholder: 'provider:model（如 wawazz:claude-opus-5）',
    candEmpty: '尚未添加竞赛模型',
    autoLoad: '检测已配置模型',
    autoLoadAria: '自动检测并加载当前已配置的模型',
    startTitle: '发起实验',
    startHint: '输入任务，点击开始：依次用面板中开启（绿）的模型对比执行，结果实时上墙',
    startBtn: '开始实验',
    startPlaceholder: '输入任务描述…',
    startRunning: '实验进行中，面板实时刷新…',
    startFailed: '启动失败：',
    panelAria: 'DSH Arena 实验工作台',
    imported: '已本地导入：',
    unableImport: '无法导入此报告：',
    notReport: '此文件不是 DSH Arena 报告。',
    statusLine: (id, count) => `${id} · ${count} 次运行`,
    cardExperiment: '实验',
    cardRuns: '运行数',
    cardPareto: '帕累托',
    cardWinner: '胜者',
    winnerNone: '需人工评审',
    empty: '暂无运行记录。启动 Arena 实验或导入本地 JSON 报告。',
    thCandidate: '候选',
    thModel: '模型',
    thState: '状态',
    thGate: '门禁',
    thQuality: '质量',
    thTime: '耗时',
    thTokens: 'Token',
    thCost: '成本',
    decision: '决策面',
    pareto: '帕累托前沿：',
    paretoNone: '无符合条件项',
    winner: '建议胜者：',
    winnerKeep: '留待人工确认',
    audit: (n) => `审计告警（${n}）`,
    auditNone: '无审计告警记录。',
    live: '实时数据',
  },
  en: {
    launcher: 'Arena',
    brand: 'DSH Arena',
    status: 'Local-first evaluation workbench',
    importReport: 'Import report',
    importAria: 'Import DSH Arena JSON report',
    chooseFile: 'Choose DSH Arena report JSON',
    closeAria: 'Close DSH Arena',
    toggle: '中文',
    toggleAria: 'Switch to Chinese',
    execOn: 'Run: On',
    execOff: 'Run: Off',
    execAria: 'Toggle experiment execution (off makes the runner refuse to run, spending no tokens)',
    candTitle: 'Competition models',
    candHint: 'Disabled models skip experiments and spend no tokens; add or remove here',
    candOn: 'On',
    candOff: 'Off',
    candAdd: 'Add',
    candAddAria: 'Add a competition model',
    candPlaceholder: 'provider:model (e.g. wawazz:claude-opus-5)',
    candEmpty: 'No competition models yet',
    autoLoad: 'Detect configured models',
    autoLoadAria: 'Detect and load the currently configured models',
    startTitle: 'Run experiment',
    startHint: 'Enter a task and start: enabled (green) models compete one by one, results stream live',
    startBtn: 'Start',
    startPlaceholder: 'Describe the task…',
    startRunning: 'Experiment running, the panel refreshes live…',
    startFailed: 'Failed to start: ',
    panelAria: 'DSH Arena experiment workbench',
    imported: 'Imported locally: ',
    unableImport: 'Unable to import this report: ',
    notReport: 'This file is not a DSH Arena report.',
    statusLine: (id, count) => `${id} · ${count} run${count === 1 ? '' : 's'}`,
    cardExperiment: 'Experiment',
    cardRuns: 'Runs',
    cardPareto: 'Pareto',
    cardWinner: 'Winner',
    winnerNone: 'Human review needed',
    empty: 'No runs yet. Start an Arena experiment or import a local JSON report.',
    thCandidate: 'Candidate',
    thModel: 'Model',
    thState: 'State',
    thGate: 'Gate',
    thQuality: 'Quality',
    thTime: 'Time',
    thTokens: 'Tokens',
    thCost: 'Cost',
    decision: 'Decision surface',
    pareto: 'Pareto frontier: ',
    paretoNone: 'none eligible',
    winner: 'Suggested winner: ',
    winnerKeep: 'none — keep human confirmation',
    audit: (n) => `Audit alerts (${n})`,
    auditNone: 'No audit alerts recorded.',
    live: 'Live data',
  },
}

window.__ModuleLoader__.load({
  id: 'dsh-arena',
  factory: () => {
    var module = { exports: {} }
    var exports = module.exports

    /** Normalizes either a live snapshot or exported Arena report into one render model. */
    function createArenaViewModel(value = {}) {
      const experiment = isRecord(value.experiment) ? value.experiment : null;
      const runs = Array.isArray(value.runs) ? value.runs.filter(isRecord) : [];
      const paretoRunIds = Array.isArray(value.paretoRunIds) ? value.paretoRunIds.filter((id) => typeof id === 'string') : [];
      const alerts = Array.isArray(value.auditAlerts) ? value.auditAlerts.filter((alert) => typeof alert === 'string') : runs.flatMap((run) => Array.isArray(run.auditAlerts) ? run.auditAlerts.filter((alert) => typeof alert === 'string') : []);
      return { experiment, runs, paretoRunIds, winnerRunId: typeof value.winnerRunId === 'string' ? value.winnerRunId : undefined, auditAlerts: alerts };
    }

    /** Parses a local Arena report and rejects unrelated JSON before it reaches the DOM. */
    function parseArenaReport(text) {
      const parsed = JSON.parse(text);
      if (!isRecord(parsed) || !isRecord(parsed.experiment) || typeof parsed.experiment.experimentId !== 'string' || !Array.isArray(parsed.runs)) {
        throw new Error('This file is not a DSH Arena report.');
      }
      return createArenaViewModel(parsed);
    }

    /** Reads the live arena service handle, or undefined when the runtime denies
     * the access: Cordis throws on reading an undeclared inject property before
     * any optional chaining can guard it, so feature detection must catch. */
    function arenaService(ctx) {
      try { return ctx.arena } catch { return undefined }
    }

    /** Resolves live service data without letting an empty-experiment report error break the UI. */
    function resolveArenaViewModel(ctx = {}) {
      const arena = arenaService(ctx);
      const snapshot = arena?.getSnapshot?.() ?? {};
      if (!snapshot.experiment || typeof arena?.report !== 'function') return createArenaViewModel(snapshot);
      try { return createArenaViewModel(arena.report()); }
      catch { return createArenaViewModel(snapshot); }
    }

    /** Builds a pill-style on/off switch: green when on, red when off. */
    function buildSwitch(on, label) {
      const btn = element('button', `switch ${on ? 'on' : 'off'}`);
      btn.type = 'button';
      btn.append(element('span', 'knob', ''), element('span', '', label));
      return btn;
    }

    /** Creates an accessible, removable Arena panel; returns an unsubscribe function. */
    function apply(ctx = globalThis) {
      if (typeof document === 'undefined') return () => {};
      let locale = 'zh';
      const t = (key, ...args) => {
        const entry = I18N[locale][key];
        return typeof entry === 'function' ? entry(...args) : entry;
      };
      const host = document.createElement('div');
      host.setAttribute('data-dsh-arena', 'true');
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = `:host{all:initial;--bg:#f8fafc;--panel:#fff;--ink:#0f172a;--muted:#64748b;--line:#dbe3ee;--accent:#5b5bd6;--good:#087f5b;--bad:#c92a2a;--warn:#a15c00;font-family:Inter,ui-sans-serif,system-ui,sans-serif}.launcher{position:fixed;right:20px;bottom:20px;z-index:2147483000;border:0;border-radius:999px;padding:11px 16px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;font-weight:750;box-shadow:0 12px 32px #312e8150;cursor:pointer}.panel{position:fixed;inset:5vh 3vw 4vh auto;z-index:2147483001;width:min(980px,94vw);overflow:auto;border:1px solid var(--line);border-radius:18px;background:var(--panel);color:var(--ink);box-shadow:0 28px 90px #0f172a3d}.hidden{display:none}.bar{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--panel) 94%,transparent);backdrop-filter:blur(12px)}.brand{font-weight:850;font-size:17px}.status{margin-right:auto;color:var(--muted);font-size:12px}.btn{border:1px solid var(--line);border-radius:9px;padding:8px 11px;background:var(--bg);color:var(--ink);font-weight:700;cursor:pointer}.close{font-size:18px;padding:4px 9px}.content{padding:18px}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:16px}.card,.section{border:1px solid var(--line);border-radius:12px;background:var(--bg)}.card{padding:12px}.label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}.value{margin-top:4px;font-size:16px;font-weight:800;overflow-wrap:anywhere}.section{margin-top:12px;padding:14px}.section h3{margin:0 0 10px;font-size:14px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:9px;border-bottom:1px solid var(--line);white-space:nowrap}th{color:var(--muted);font-size:10px;text-transform:uppercase}.badge{display:inline-block;border-radius:999px;padding:3px 7px;background:#e2e8f0;font-weight:750}.passed,.verified{color:var(--good)}.failed{color:var(--bad)}.blocked,.unverified,.stale,.partial{color:var(--warn)}.empty{padding:30px;text-align:center;color:var(--muted)}.alert{margin:6px 0;padding:9px;border-left:3px solid var(--warn);background:#fffbeb}.error{color:var(--bad);font-weight:700;min-height:1.4em;margin:8px 0}.foot{color:var(--muted);font-size:11px;margin-top:10px}.switch{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:999px;padding:4px 10px;background:var(--bg);color:var(--ink);font-weight:700;cursor:pointer;font-size:12px}.switch .knob{width:14px;height:14px;border-radius:50%;background:var(--muted);transition:background .15s}.switch.on{background:#e6f4ea;border-color:var(--good);color:var(--good)}.switch.on .knob{background:var(--good)}.switch.off{background:#fdecea;border-color:var(--bad);color:var(--bad)}.switch.off .knob{background:var(--bad)}.bar-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px}.bar-row h3{margin:0}.add-row{display:flex;gap:8px;margin-top:12px}.add-row input{flex:1;min-width:0;padding:7px 10px;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--ink);font-size:12px}.add-row .btn{white-space:nowrap}@media(max-width:700px){.panel{inset:0;width:100vw;border-radius:0}.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.bar{flex-wrap:wrap}.status{width:100%;order:2}}@media(prefers-color-scheme:dark){:host{--bg:#111827;--panel:#0b1220;--ink:#e5e7eb;--muted:#94a3b8;--line:#26344b}.badge{background:#1e293b}}`;
      const launcher = element('button', 'launcher', t('launcher'));
      launcher.type = 'button'; launcher.setAttribute('aria-expanded', 'false'); launcher.setAttribute('aria-controls', 'dsh-arena-panel');
      const panel = element('section', 'panel hidden');
      panel.id = 'dsh-arena-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'false'); panel.setAttribute('aria-label', t('panelAria'));
      const bar = element('header', 'bar');
      const brand = element('div', 'brand', t('brand'));
      const status = element('div', 'status', t('status')); status.setAttribute('aria-live', 'polite');
      const importButton = element('button', 'btn', t('importReport')); importButton.type = 'button'; importButton.setAttribute('aria-label', t('importAria'));
      const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = 'application/json,.json'; fileInput.hidden = true; fileInput.setAttribute('aria-label', t('chooseFile'));
      const toggle = element('button', 'btn', t('toggle')); toggle.type = 'button'; toggle.setAttribute('aria-label', t('toggleAria'));
      const execSwitch = buildSwitch(true, t('execOn')); execSwitch.setAttribute('aria-label', t('execAria'));
      const setExecSwitch = () => {
        execSwitch.className = `switch ${executionAllowed ? 'on' : 'off'}`;
        execSwitch.lastChild.textContent = executionAllowed ? t('execOn') : t('execOff');
      };
      const close = element('button', 'btn close', '×'); close.type = 'button'; close.setAttribute('aria-label', t('closeAria'));
      bar.append(brand, status, importButton, fileInput, toggle, execSwitch, close);
      const content = element('main', 'content');
      const error = element('div', 'error'); error.setAttribute('role', 'alert');
      const view = document.createElement('div');
      const startBox = element('section', 'section');
      const startHead = element('h3', '', t('startTitle'));
      const startHint = element('div', 'foot', t('startHint'));
      const startRow = element('div', 'add-row');
      const taskInput = document.createElement('input');
      taskInput.type = 'text'; taskInput.placeholder = t('startPlaceholder'); taskInput.setAttribute('aria-label', t('startPlaceholder'));
      const startBtn = element('button', 'btn', t('startBtn')); startBtn.type = 'button';
      const startStatus = element('div', 'foot', '');
      startRow.append(taskInput, startBtn);
      startBox.append(startHead, startHint, startRow, startStatus);
      const startExperiment = async () => {
        const task = taskInput.value.trim();
        if (!task || experimentRunning) return;
        try {
          const response = await fetch('/plugins/arena/start', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ task }),
          });
          const data = await response.json();
          if (data?.ok) {
            experimentRunning = true;
            taskInput.value = '';
            startStatus.textContent = t('startRunning');
            render();
          } else {
            startStatus.textContent = t('startFailed') + (data?.error ?? response.status);
          }
        } catch (error) {
          startStatus.textContent = t('startFailed') + (error instanceof Error ? error.message : String(error));
        }
      };
      const candBox = element('section', 'section');
      const candHeadRow = element('div', 'bar-row');
      const candHead = element('h3', '', t('candTitle'));
      const candHint = element('div', 'foot', t('candHint'));
      const candListEl = element('div', 'cards');
      const autoLoadBtn = element('button', 'btn', t('autoLoad')); autoLoadBtn.type = 'button'; autoLoadBtn.setAttribute('aria-label', t('autoLoadAria'));
      const addRow = element('div', 'add-row');
      const candInput = document.createElement('input');
      candInput.type = 'text'; candInput.placeholder = t('candPlaceholder'); candInput.setAttribute('aria-label', t('candPlaceholder'));
      const candAddBtn = element('button', 'btn', t('candAdd')); candAddBtn.type = 'button'; candAddBtn.setAttribute('aria-label', t('candAddAria'));
      addRow.append(candInput, candAddBtn);
      candHeadRow.append(candHead, autoLoadBtn);
      candBox.append(candHeadRow, candHint, candListEl, addRow);
      content.append(startBox, candBox, error, view); panel.append(bar, content); shadow.append(style, launcher, panel); document.body.append(host);

      /** Renders the per-model competition list; each model has its own switch. */
      const renderCandidates = async () => {
        try {
          const response = await fetch('/plugins/arena/candidates');
          if (!response.ok) return;
          const data = await response.json();
          const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
          candListEl.replaceChildren();
          if (!candidates.length) {
            candListEl.append(element('div', 'section empty', t('candEmpty')));
            return;
          }
          for (const candidate of candidates) {
            const card = element('div', 'card');
            card.append(element('div', 'label', `${candidate.provider}:${candidate.model}`));
            const toggleBtn = buildSwitch(candidate.enabled, candidate.enabled ? t('candOn') : t('candOff'));
            toggleBtn.setAttribute('aria-label', `${candidate.provider}:${candidate.model} ${candidate.enabled ? t('candOff') : t('candOn')}`);
            toggleBtn.addEventListener('click', async () => {
              try {
                await fetch('/plugins/arena/candidates', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ provider: candidate.provider, model: candidate.model, enabled: !candidate.enabled }),
                });
              } catch { /* keep current state on failure */ }
              await renderCandidates();
            });
            card.append(toggleBtn);
            candListEl.append(card);
          }
        } catch { /* host route may be absent; leave the section empty */ }
      };
      /** Detects configured providers/models via the settings RPC and merges
       * the missing ones into the competition list (existing toggles stay). */
      const autoLoadModels = async () => {
        try {
          const response = await fetch('/api/llm.models', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'client-request', rpcId: 'arena-autoload', method: 'llm.models', payload: {} }),
          });
          if (!response.ok) return;
          const data = await response.json();
          const groups = data?.result?.value?.groups ?? [];
          const current = await (await fetch('/plugins/arena/candidates')).json();
          const known = new Set((current?.candidates ?? []).map((candidate) => `${candidate.provider}:${candidate.model}`));
          for (const group of groups) {
            for (const model of group.models ?? []) {
              if (!group.id || !model?.id || known.has(`${group.id}:${model.id}`)) continue;
              try {
                await fetch('/plugins/arena/candidates', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ provider: group.id, model: model.id, enabled: true }),
                });
                known.add(`${group.id}:${model.id}`);
              } catch { /* keep going on individual failures */ }
            }
          }
        } catch { /* rpc may be unavailable on this host */ }
        await renderCandidates();
      };
      const addCandidate = async () => {
        const spec = candInput.value.trim();
        const [provider, model] = spec.split(':');
        if (!provider || !model) return;
        try {
          await fetch('/plugins/arena/candidates', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider, model, enabled: true }),
          });
          candInput.value = '';
        } catch { /* keep input on failure */ }
        await renderCandidates();
      };

      let importedModel;
      let liveModel = resolveArenaViewModel(ctx);
      let experimentRunning = false;
      let priorFocus;
      const render = () => renderModel(view, importedModel ?? liveModel, status, t);
      const open = () => { priorFocus = document.activeElement; panel.classList.remove('hidden'); launcher.setAttribute('aria-expanded', 'true'); render(); close.focus(); void autoLoadModels(); };
      const dismiss = () => { panel.classList.add('hidden'); launcher.setAttribute('aria-expanded', 'false'); if (priorFocus && typeof priorFocus.focus === 'function') priorFocus.focus(); else launcher.focus(); };
      const togglePanel = () => panel.classList.contains('hidden') ? open() : dismiss();
      const keydown = (event) => { if (event.key === 'Escape' && !panel.classList.contains('hidden')) dismiss(); };
      const importReport = async () => {
        error.textContent = '';
        const file = fileInput.files?.[0];
        if (!file) return;
        try { importedModel = parseArenaReport(await file.text()); render(); status.textContent = t('imported') + file.name; }
        catch (failure) { error.textContent = t('unableImport') + (failure instanceof Error ? failure.message : t('notReport')); }
        finally { fileInput.value = ''; }
      };
      const applyTexts = () => {
        launcher.textContent = t('launcher');
        brand.textContent = t('brand');
        status.textContent = t('status');
        importButton.textContent = t('importReport');
        importButton.setAttribute('aria-label', t('importAria'));
        fileInput.setAttribute('aria-label', t('chooseFile'));
        toggle.textContent = t('toggle');
        toggle.setAttribute('aria-label', t('toggleAria'));
        setExecSwitch();
        startHead.textContent = t('startTitle');
        startHint.textContent = t('startHint');
        taskInput.placeholder = t('startPlaceholder');
        startBtn.textContent = t('startBtn');
        if (!experimentRunning && startStatus.textContent === t('startRunning')) startStatus.textContent = '';
        candHead.textContent = t('candTitle');
        candHint.textContent = t('candHint');
        candInput.placeholder = t('candPlaceholder');
        candAddBtn.textContent = t('candAdd');
        autoLoadBtn.textContent = t('autoLoad');
        close.setAttribute('aria-label', t('closeAria'));
        panel.setAttribute('aria-label', t('panelAria'));
        render();
        void renderCandidates();
      };
      const switchLocale = () => { locale = locale === 'zh' ? 'en' : 'zh'; applyTexts(); };
      let executionAllowed = true;
      const syncExecutionSwitch = async () => {
        try {
          const response = await fetch('/plugins/arena/policy');
          if (!response.ok) return;
          const policy = await response.json();
          if (policy && (policy.executionPolicy === 'allowed' || policy.executionPolicy === 'blocked')) {
            executionAllowed = policy.executionPolicy === 'allowed';
            setExecSwitch();
          }
        } catch { /* host route may be absent; keep the last known state */ }
      };
      const flipExecution = async () => {
        const next = executionAllowed ? 'blocked' : 'allowed';
        try {
          const response = await fetch('/plugins/arena/policy', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ executionPolicy: next }),
          });
          if (!response.ok) return;
          const policy = await response.json();
          if (policy && policy.ok) {
            executionAllowed = policy.executionPolicy === 'allowed';
            setExecSwitch();
          }
        } catch { /* keep current state on failure */ }
      };
      const refreshRunning = async () => {
        try {
          const response = await fetch('/plugins/arena/policy');
          if (!response.ok) return;
          const policy = await response.json();
          if (policy && typeof policy.running === 'boolean') {
            experimentRunning = policy.running;
            startBtn.disabled = experimentRunning;
            if (experimentRunning) startStatus.textContent = t('startRunning');
          }
        } catch { /* keep the last known state */ }
      };
      const refreshLive = async () => {
        if (panel.classList.contains('hidden')) return;
        void refreshRunning();
        if (importedModel) return;
        try {
          const response = await fetch('/plugins/arena/snapshot');
          if (!response.ok) return;
          const snapshot = await response.json();
          if (!snapshot || !isRecord(snapshot.experiment)) return;
          liveModel = createArenaViewModel(snapshot);
          render();
        } catch { /* host route may be absent; the panel keeps the imported/empty view */ }
      };
      launcher.addEventListener('click', togglePanel); close.addEventListener('click', dismiss); importButton.addEventListener('click', () => fileInput.click()); fileInput.addEventListener('change', importReport); document.addEventListener('keydown', keydown);
      toggle.addEventListener('click', switchLocale);
      execSwitch.addEventListener('click', flipExecution);
      candAddBtn.addEventListener('click', addCandidate);
      autoLoadBtn.addEventListener('click', () => { void autoLoadModels(); });
      startBtn.addEventListener('click', startExperiment);
      void syncExecutionSwitch();
      void renderCandidates();
      void refreshRunning();
      const arena = arenaService(ctx);
      const unsubscribe = typeof arena?.subscribe === 'function' ? arena.subscribe(() => { if (!importedModel) render(); }) : undefined;
      const pollTimer = setInterval(() => { void refreshLive(); }, 5000);
      const autoLoadTimer = setInterval(() => { if (!panel.classList.contains('hidden')) void autoLoadModels(); }, 30000);
      void autoLoadModels();
      render();
      return () => { launcher.removeEventListener('click', togglePanel); close.removeEventListener('click', dismiss); importButton.removeEventListener('click', () => fileInput.click()); fileInput.removeEventListener('change', importReport); document.removeEventListener('keydown', keydown); toggle.removeEventListener('click', switchLocale); execSwitch.removeEventListener('click', flipExecution); candAddBtn.removeEventListener('click', addCandidate); autoLoadBtn.removeEventListener('click', () => { void autoLoadModels(); }); startBtn.removeEventListener('click', startExperiment); unsubscribe?.(); clearInterval(pollTimer); clearInterval(autoLoadTimer); host.remove(); };
    }

    /** Renders all dynamic values with textContent so imported reports cannot inject markup. */
    function renderModel(root, model, status, t) {
      root.replaceChildren();
      const experimentId = model.experiment?.experimentId ?? '—';
      status.textContent = t('statusLine', experimentId, model.runs.length);
      const cards = element('div', 'cards');
      for (const [label, value] of [[t('cardExperiment'), experimentId], [t('cardRuns'), String(model.runs.length)], [t('cardPareto'), model.paretoRunIds.length ? String(model.paretoRunIds.length) : '—'], [t('cardWinner'), model.winnerRunId ?? t('winnerNone')]]) {
        const card = element('div', 'card'); card.append(element('div', 'label', label), element('div', 'value', value)); cards.append(card);
      }
      root.append(cards);
      if (!model.runs.length) {
        const empty = element('div', 'section empty', t('empty')); root.append(empty); return;
      }
      const runSection = section(model.experiment?.task ?? '');
      const wrap = element('div', 'table-wrap'); const table = document.createElement('table');
      const head = document.createElement('thead'); const headRow = document.createElement('tr');
      for (const title of [t('thCandidate'), t('thModel'), t('thState'), t('thGate'), t('thQuality'), t('thTime'), t('thTokens'), t('thCost')]) headRow.append(element('th', '', title));
      head.append(headRow); table.append(head);
      const body = document.createElement('tbody');
      for (const run of model.runs) {
        const row = document.createElement('tr');
        const cells = [run.runId ?? '—', run.candidate?.model ?? run.candidate?.provider ?? '—', run.state ?? '—', run.gateStatus ?? '—', metric(run.metrics?.quality), duration(run.metrics?.durationMs), metric(run.metrics?.tokens), metric(run.metrics?.cost)];
        cells.forEach((value, index) => { const cell = element('td', '', String(value)); if (index === 2 || index === 3) { const badge = element('span', `badge ${String(value).toLowerCase()}`, String(value)); cell.replaceChildren(badge); } row.append(cell); });
        body.append(row);
      }
      table.append(body); wrap.append(table); runSection.append(wrap); root.append(runSection);
      const decision = section(t('decision'));
      decision.append(element('div', '', `${t('pareto')}${model.paretoRunIds.length ? model.paretoRunIds.join(', ') : t('paretoNone')}`), element('div', 'foot', `${t('winner')}${model.winnerRunId ?? t('winnerKeep')}`)); root.append(decision);
      const audit = section(t('audit', model.auditAlerts.length));
      if (model.auditAlerts.length) for (const alert of model.auditAlerts) audit.append(element('div', 'alert', alert)); else audit.append(element('div', 'foot', t('auditNone')));
      root.append(audit);
    }

    /** Creates a DOM element whose optional dynamic text is assigned safely. */
    function element(tag, className = '', text = '') { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; }

    /** Creates a consistently styled section with a safe heading. */
    function section(title) { const node = element('section', 'section'); node.append(element('h3', '', title)); return node; }

    /** Formats an absent numeric metric without inventing zero. */
    function metric(value) { return typeof value === 'number' && Number.isFinite(value) ? String(value) : '—'; }

    /** Formats milliseconds for fast visual comparison. */
    function duration(value) { return typeof value === 'number' && Number.isFinite(value) ? `${(value / 1000).toFixed(1)}s` : '—'; }

    /** Narrows imported JSON objects. */
    function isRecord(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); }

    exports.apply = apply
    exports.inject = []
    exports.createArenaViewModel = createArenaViewModel
    exports.parseArenaReport = parseArenaReport
    exports.resolveArenaViewModel = resolveArenaViewModel
    return module.exports
  }
})

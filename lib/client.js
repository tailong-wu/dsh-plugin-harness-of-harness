window.__ModuleLoader__.load({
	id: "dsh-plugin-harness-of-harness",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// client/index.jsx
var index_exports = {};
__export(index_exports, {
  TAB_ID: () => TAB_ID,
  TAB_KIND: () => TAB_KIND,
  apply: () => apply,
  inject: () => inject,
  name: () => name,
  registerPanelUi: () => registerPanelUi
});
module.exports = __toCommonJS(index_exports);

// src/contract.js
var ROUTE_PREFIX = "/api/plugins/hoh-harness-of-harness";
var CONFIG_PATH = `${ROUTE_PREFIX}/config`;
var STATE_PATH = `${ROUTE_PREFIX}/state`;
var START_PATH = `${ROUTE_PREFIX}/start`;
var STOP_PATH = `${ROUTE_PREFIX}/stop`;
var ROLES = ["planner", "developer", "tester"];
var LOCALE_NAMESPACE = "hohPanel";

// client/app.jsx
var import_react = require("react");

// client/data.js
async function readError(response) {
  try {
    const body = await response.json();
    if (body !== null && typeof body.error === "string" && body.error !== "") return body.error;
  } catch {
  }
  return `Harness of Harness request failed (${response.status}).`;
}
async function fetchConfig(signal) {
  const response = await fetch(CONFIG_PATH, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    ...signal === void 0 ? {} : { signal }
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}
async function fetchState(sessionId, signal) {
  const query = sessionId === void 0 || sessionId === "" ? "" : `?session=${encodeURIComponent(sessionId)}`;
  const response = await fetch(`${STATE_PATH}${query}`, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    ...signal === void 0 ? {} : { signal }
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}
async function startRun(request, signal) {
  const response = await fetch(START_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    ...signal === void 0 ? {} : { signal }
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}
async function stopRun(sessionId, signal) {
  const response = await fetch(STOP_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
    ...signal === void 0 ? {} : { signal }
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

// client/format.js
function elapsed(from, to = Date.now()) {
  const seconds = Math.max(0, Math.round((to - from) / 1e3));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
function clockTime(ms) {
  return new Date(ms).toLocaleTimeString();
}
function fill(text2, values) {
  return text2.replace(/\{(\w+)\}/g, (match, key) => key in values ? String(values[key]) : match);
}

// client/locale.js
var ZH = {
  button: "HoH",
  open: "打开 Harness of Harness",
  title: "Harness of Harness",
  subtitle: "持续开发循环",
  guideTitle: "Harness of Harness",
  guideDescription: "用 DSH 子代理运行 Planner–Developer–Tester 持续开发循环，并在面板中跟踪每一轮迭代。",
  modeOn: "模式运行中",
  modeOff: "模式未开启",
  statusRunning: "运行中",
  statusStopping: "正在停止…",
  statusStopped: "已停止",
  statusDone: "已完成",
  statusPartial: "部分完成",
  statusError: "出错",
  goal: "目标与需求",
  goalPlaceholder: "描述这个项目要实现什么。每一轮的 Planner 都会读到这段文字。",
  projectDir: "项目目录",
  iterations: "迭代次数",
  start: "启动 HoH 模式",
  restart: "再跑一轮",
  stop: "停止",
  newRun: "新建运行",
  rolePlanner: "规划 Planner",
  roleDeveloper: "开发 Developer",
  roleTester: "测试 QA Tester",
  phasePending: "待运行",
  phaseRunning: "进行中",
  phaseDone: "已完成",
  phaseFailed: "失败",
  phaseSkipped: "已跳过",
  iterationOf: "第 {index} / {total} 轮",
  history: "迭代历史",
  log: "运行日志",
  empty: "还没有运行记录。填写目标与项目目录，然后启动 HoH 模式。",
  noHistory: "这一轮还没有完成任何角色。",
  runDir: "运行记录目录",
  plan: "开发文档",
  evidence: "证据",
  summary: "小结",
  noSummary: "（该角色没有留下小结）",
  elapsed: "已用时 {time}",
  startedAt: "开始于 {time}",
  loading: "正在加载…",
  error: "无法加载",
  network: "连接不到 dsh 服务，请确认它还在运行。",
  retry: "重试",
  refresh: "刷新",
  currentChild: "子会话 {id}",
  repair: "修复 {n}",
  verdictPassed: "判定：通过",
  verdictFailed: "判定：{gaps} 个缺口"
};
var EN = {
  button: "HoH",
  open: "Open Harness of Harness",
  title: "Harness of Harness",
  subtitle: "Continual development loop",
  guideTitle: "Harness of Harness",
  guideDescription: "Run the Planner-Developer-Tester continual-development loop with DSH subagents and follow every iteration in this panel.",
  modeOn: "Mode running",
  modeOff: "Mode off",
  statusRunning: "Running",
  statusStopping: "Stopping…",
  statusStopped: "Stopped",
  statusDone: "Completed",
  statusPartial: "Partially completed",
  statusError: "Failed",
  goal: "Goal and requirements",
  goalPlaceholder: "Describe what this project should become. Every iteration's Planner reads this text.",
  projectDir: "Project directory",
  iterations: "Iterations",
  start: "Start HoH mode",
  restart: "Run again",
  stop: "Stop",
  newRun: "New run",
  rolePlanner: "Project Planner",
  roleDeveloper: "Developer",
  roleTester: "QA Tester",
  phasePending: "pending",
  phaseRunning: "running",
  phaseDone: "done",
  phaseFailed: "failed",
  phaseSkipped: "skipped",
  iterationOf: "Iteration {index} / {total}",
  history: "Iteration history",
  log: "Run log",
  empty: "No run yet. Fill in the goal and the project directory, then start HoH mode.",
  noHistory: "No role has finished in this iteration yet.",
  runDir: "Run records",
  plan: "Development document",
  evidence: "Evidence",
  summary: "Summary",
  noSummary: "(this role left no summary)",
  elapsed: "{time} elapsed",
  startedAt: "started {time}",
  loading: "Loading…",
  error: "Could not load",
  network: "Could not reach the dsh server; check that it is still running.",
  retry: "Retry",
  refresh: "Refresh",
  currentChild: "child session {id}",
  repair: "repair {n}",
  verdictPassed: "verdict: passed",
  verdictFailed: "verdict: {gaps} gap(s)"
};

// client/app.jsx
var import_jsx_runtime = require("react/jsx-runtime");
var POLL_MS = 1500;
var LOG_LINES = 40;
function text(t, key) {
  if (typeof t === "function") {
    const resolved = t(key);
    if (typeof resolved === "string" && resolved !== "" && resolved !== key) return resolved;
  }
  return EN[key] ?? key;
}
function runStatusLabel(t, status) {
  switch (status) {
    case "running":
      return text(t, "statusRunning");
    case "stopping":
      return text(t, "statusStopping");
    case "stopped":
      return text(t, "statusStopped");
    case "done":
      return text(t, "statusDone");
    case "partial":
      return text(t, "statusPartial");
    case "error":
      return text(t, "statusError");
    default:
      return status;
  }
}
function roleLabel(t, role) {
  if (role === "planner") return text(t, "rolePlanner");
  if (role === "developer") return text(t, "roleDeveloper");
  if (role === "tester") return text(t, "roleTester");
  return role;
}
function phaseLabel(t, status) {
  switch (status) {
    case "pending":
      return text(t, "phasePending");
    case "running":
      return text(t, "phaseRunning");
    case "done":
      return text(t, "phaseDone");
    case "failed":
      return text(t, "phaseFailed");
    case "skipped":
      return text(t, "phaseSkipped");
    default:
      return status;
  }
}
function PhaseRow({ phase, now, t }) {
  const state = phase.status ?? "pending";
  const round = typeof phase.round === "number" ? phase.round : 0;
  const verdict = phase.verdict ?? null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "hoh-step", "data-state": state, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "hoh-dot", style: { alignSelf: "center" } }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "hoh-step-name", children: roleLabel(t, phase.role) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "hoh-step-state", children: [
      phaseLabel(t, state),
      round > 0 ? ` · ${fill(text(t, "repair"), { n: round })}` : "",
      phase.startedAt !== void 0 && phase.startedAt !== null ? ` · ${elapsed(phase.startedAt, phase.endedAt ?? now)}` : ""
    ] }),
    verdict !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "hoh-meta hoh-summary", children: verdict.passed ? text(t, "verdictPassed") : fill(text(t, "verdictFailed"), { gaps: (verdict.gaps ?? []).length }) }) : null,
    phase.summary !== void 0 && phase.summary !== "" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "hoh-summary", children: phase.summary }) : null,
    phase.reason !== void 0 && phase.reason !== null && phase.reason !== "" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "hoh-summary", children: phase.reason }) : null,
    phase.childId !== void 0 && phase.childId !== null && phase.childId !== "" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "hoh-meta hoh-summary", children: fill(text(t, "currentChild"), { id: phase.childId }) }) : null
  ] });
}
function IterationCard({ iteration, run, now, t }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "hoh-iteration", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "hoh-iteration-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: fill(text(t, "iterationOf"), { index: iteration.index, total: run.iterations }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "hoh-step-state", children: iteration.endedAt === null ? elapsed(iteration.startedAt, now) : elapsed(iteration.startedAt, iteration.endedAt) })
    ] }),
    (iteration.phases ?? []).length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "hoh-meta", children: text(t, "noHistory") }) : (iteration.phases ?? []).map((phase) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PhaseRow, { phase, now, t }, phase.role)),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "hoh-meta", children: [
      `${run.runDir}/iteration-${iteration.index}/plan.md`,
      " · ",
      `${run.runDir}/iteration-${iteration.index}/evidence.md`
    ] })
  ] });
}
function HohPanel({ sessionId, t }) {
  const [config, setConfig] = (0, import_react.useState)(void 0);
  const [configError, setConfigError] = (0, import_react.useState)("");
  const [run, setRun] = (0, import_react.useState)(null);
  const [runError, setRunError] = (0, import_react.useState)("");
  const [loading, setLoading] = (0, import_react.useState)(true);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [nonce, setNonce] = (0, import_react.useState)(0);
  const [goal, setGoal] = (0, import_react.useState)("");
  const [projectDir, setProjectDir] = (0, import_react.useState)("");
  const [iterations, setIterations] = (0, import_react.useState)(3);
  const [now, setNow] = (0, import_react.useState)(() => Date.now());
  const seeded = (0, import_react.useRef)(false);
  (0, import_react.useEffect)(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchConfig(controller.signal).then(
      (answer) => {
        if (controller.signal.aborted) return;
        setConfig(answer);
        setConfigError("");
        if (!seeded.current && answer?.defaults) {
          seeded.current = true;
          setProjectDir(answer.defaults.projectDir ?? "");
          setIterations(answer.defaults.iterations ?? 3);
        }
      },
      (cause) => {
        if (controller.signal.aborted) return;
        setConfigError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => {
      controller.abort();
    };
  }, [nonce]);
  const enabled = config?.enabled !== false;
  (0, import_react.useEffect)(() => {
    if (!enabled) {
      setLoading(false);
      return void 0;
    }
    const controller = new AbortController();
    fetchState(sessionId, controller.signal).then(
      (answer) => {
        if (controller.signal.aborted) return;
        setRun(answer?.run ?? null);
        setRunError("");
        setLoading(false);
      },
      (cause) => {
        if (controller.signal.aborted) return;
        setRunError(cause instanceof Error ? cause.message : String(cause));
        setLoading(false);
      }
    );
    return () => {
      controller.abort();
    };
  }, [enabled, sessionId, nonce]);
  const live = run !== null && (run.status === "running" || run.status === "stopping");
  (0, import_react.useEffect)(() => {
    if (!live) return void 0;
    const timer = setInterval(() => setNow(Date.now()), 1e3);
    return () => {
      clearInterval(timer);
    };
  }, [live]);
  (0, import_react.useEffect)(() => {
    if (!live) return void 0;
    const controller = new AbortController();
    const timer = setInterval(() => {
      fetchState(sessionId, controller.signal).then(
        (answer) => {
          if (controller.signal.aborted) return;
          setRun(answer?.run ?? null);
          setRunError("");
        },
        (cause) => {
          if (controller.signal.aborted) return;
          setRunError(cause instanceof Error ? cause.message : String(cause));
        }
      );
    }, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [live, sessionId]);
  const refresh = (0, import_react.useCallback)(() => setNonce((value) => value + 1), []);
  const onStart = (0, import_react.useCallback)(() => {
    setBusy(true);
    setRunError("");
    const request = {
      sessionId,
      goal,
      projectDir,
      iterations: Number.isInteger(iterations) ? iterations : Number(iterations) || 1
    };
    startRun(request).then(
      (answer) => {
        setBusy(false);
        setRun(answer?.run ?? null);
      },
      (cause) => {
        setBusy(false);
        setRunError(cause instanceof Error ? cause.message : String(cause));
      }
    );
  }, [goal, iterations, projectDir, sessionId]);
  const onStop = (0, import_react.useCallback)(() => {
    setBusy(true);
    setRunError("");
    stopRun(sessionId).then(
      (answer) => {
        setBusy(false);
        if (answer?.run) setRun(answer.run);
        else refresh();
      },
      (cause) => {
        setBusy(false);
        setRunError(cause instanceof Error ? cause.message : String(cause));
      }
    );
  }, [refresh, sessionId]);
  const current = run !== null && run.history !== void 0 && run.history.length > 0 ? run.history[run.history.length - 1] : void 0;
  const logLines = (0, import_react.useMemo)(() => {
    if (run === null || !Array.isArray(run.log)) return [];
    return run.log.slice(-LOG_LINES);
  }, [run]);
  if (configError !== "" && config === void 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "hoh-root", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "hoh-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "hoh-title", children: text(t, "title") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "hoh-sub", children: text(t, "subtitle") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "hoh-banner", "data-kind": "error", children: configError }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "hoh-actions", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "hoh-button", onClick: refresh, children: text(t, "retry") }) })
    ] });
  }
  if (!enabled) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "hoh-root", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "hoh-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "hoh-title", children: text(t, "title") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "hoh-sub", children: text(t, "subtitle") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "hoh-banner", "data-kind": "empty", children: text(t, "modeOff") })
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "hoh-root", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "hoh-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "hoh-title", children: text(t, "title") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "hoh-sub", children: text(t, "subtitle") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "hoh-chip", "data-status": run === null ? "idle" : run.status, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "hoh-dot" }),
      run === null ? text(t, "modeOff") : runStatusLabel(t, run.status)
    ] }),
    runError !== "" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "hoh-banner", "data-kind": "error", children: runError }) : null,
    run !== null && run.error !== null && run.error !== void 0 && run.error !== "" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "hoh-banner", "data-kind": "error", children: run.error }) : null,
    live ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "hoh-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "hoh-row", style: { justifyContent: "space-between" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "hoh-step-name", children: fill(text(t, "iterationOf"), { index: run.currentIteration, total: run.iterations }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "hoh-meta", children: fill(text(t, "elapsed"), { time: elapsed(run.startedAt, now) }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "hoh-pipeline", children: ROLES.map((role) => {
        const phase = [...current?.phases ?? []].reverse().find((entry) => entry.role === role);
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          PhaseRow,
          {
            phase: phase ?? { role, status: "pending" },
            now,
            t
          },
          role
        );
      }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "hoh-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            className: "hoh-button",
            "data-primary": "true",
            disabled: busy || run.status === "stopping",
            onClick: onStop,
            children: text(t, "stop")
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "hoh-button", onClick: refresh, children: text(t, "refresh") })
      ] })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "hoh-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "hoh-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "hoh-label", htmlFor: "hoh-goal", children: text(t, "goal") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "textarea",
          {
            id: "hoh-goal",
            className: "hoh-textarea",
            value: goal,
            placeholder: text(t, "goalPlaceholder"),
            onChange: (event) => setGoal(event.target.value)
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "hoh-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "hoh-label", htmlFor: "hoh-dir", children: text(t, "projectDir") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            id: "hoh-dir",
            className: "hoh-input",
            value: projectDir,
            onChange: (event) => setProjectDir(event.target.value)
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "hoh-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "hoh-label", htmlFor: "hoh-iterations", children: text(t, "iterations") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            id: "hoh-iterations",
            className: "hoh-input",
            type: "number",
            min: "1",
            max: "50",
            value: iterations,
            onChange: (event) => setIterations(Number(event.target.value))
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "hoh-actions", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: "hoh-button",
          "data-primary": "true",
          disabled: busy || goal.trim() === "",
          onClick: onStart,
          children: run === null ? text(t, "start") : text(t, "restart")
        }
      ) })
    ] }),
    loading && run === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "hoh-meta", children: text(t, "loading") }) : null,
    run === null && !loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "hoh-banner", "data-kind": "empty", children: text(t, "empty") }) : null,
    logLines.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "hoh-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "hoh-label", children: text(t, "log") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "hoh-log", children: logLines.map((line, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "hoh-log-line", "data-level": line.level, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "hoh-log-time", children: clockTime(line.time) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: line.text })
      ] }, `${line.time}-${index}`)) })
    ] }) : null,
    run !== null && run.history !== void 0 && run.history.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "hoh-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "hoh-label", children: text(t, "history") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "hoh-pipeline", children: run.history.slice().reverse().map((iteration) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        IterationCard,
        {
          iteration,
          run,
          now,
          t
        },
        iteration.index
      )) })
    ] }) : null,
    run !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "hoh-meta", children: [
      text(t, "runDir"),
      ": ",
      run.runDir
    ] }) : null
  ] });
}

// client/styles.js
var STYLE_ID = "hoh-panel-styles";
var CSS = `
.hoh-root {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  min-height: 100%;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary, inherit);
  overflow-y: auto;
}
.hoh-head { display: flex; flex-direction: column; gap: 2px; }
.hoh-title { font-size: 14px; font-weight: 600; }
.hoh-sub { color: var(--dsw-alias-label-secondary, inherit); font-size: 11px; }
.hoh-chip {
  display: inline-flex; align-items: center; gap: 6px;
  align-self: flex-start;
  padding: 2px 8px; border-radius: 999px; font-size: 11px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.35));
  color: var(--dsw-alias-label-secondary, inherit);
}
.hoh-chip[data-status="running"], .hoh-chip[data-status="stopping"] { color: var(--dsw-alias-brand-primary, inherit); }
.hoh-chip[data-status="done"] { color: var(--dsw-alias-state-success-primary, inherit); }
.hoh-chip[data-status="error"] { color: var(--dsw-alias-state-error-primary, inherit); }
.hoh-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.hoh-card {
  border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.35));
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  padding: 10px;
  display: flex; flex-direction: column; gap: 8px;
}
.hoh-field { display: flex; flex-direction: column; gap: 4px; }
.hoh-label { font-size: 11px; color: var(--dsw-alias-label-secondary, inherit); }
.hoh-input, .hoh-textarea {
  width: 100%; box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.35));
  border-radius: 6px;
  background: var(--dsw-alias-bg-base, transparent);
  color: inherit; font: inherit; padding: 6px 8px;
}
.hoh-textarea { min-height: 88px; resize: vertical; }
.hoh-input:focus, .hoh-textarea:focus { outline: 1px solid var(--dsw-alias-brand-primary, currentColor); }
.hoh-row { display: flex; align-items: center; gap: 8px; }
.hoh-actions { display: flex; gap: 8px; }
.hoh-button {
  border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.35));
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2, transparent);
  color: inherit; font: inherit; padding: 5px 10px; cursor: pointer;
}
.hoh-button:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2, currentColor); }
.hoh-button:disabled { opacity: .5; cursor: default; }
.hoh-button[data-primary="true"] {
  border-color: var(--dsw-alias-brand-primary, currentColor);
  color: var(--dsw-alias-brand-primary, inherit);
}
.hoh-pipeline { display: flex; flex-direction: column; gap: 6px; }
.hoh-step {
  display: grid; grid-template-columns: 14px 1fr auto; align-items: baseline;
  gap: 8px; padding: 6px 8px; border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.35));
}
.hoh-step[data-state="running"] { border-color: var(--dsw-alias-brand-primary, currentColor); }
.hoh-step[data-state="failed"] { border-color: var(--dsw-alias-state-error-primary, currentColor); }
.hoh-step-name { font-weight: 600; }
.hoh-step-state { color: var(--dsw-alias-label-secondary, inherit); font-size: 11px; white-space: nowrap; }
.hoh-summary {
  grid-column: 2 / 4;
  white-space: pre-wrap; word-break: break-word;
  color: var(--dsw-alias-label-secondary, inherit);
  font-size: 11px;
  max-height: 9em; overflow: auto;
}
.hoh-meta { color: var(--dsw-alias-label-secondary, inherit); font-size: 11px; word-break: break-all; }
.hoh-link { color: var(--dsw-alias-brand-primary, inherit); text-decoration: none; }
.hoh-link:hover { text-decoration: underline; }
.hoh-log {
  border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.35));
  border-radius: 8px; padding: 8px;
  max-height: 180px; overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
}
.hoh-log-line { display: flex; gap: 8px; }
.hoh-log-time { color: var(--dsw-alias-label-secondary, inherit); white-space: nowrap; }
.hoh-log-line[data-level="warn"] { color: var(--dsw-alias-state-warn-primary, inherit); }
.hoh-log-line[data-level="error"] { color: var(--dsw-alias-state-error-primary, inherit); }
.hoh-iteration { display: flex; flex-direction: column; gap: 4px; padding: 8px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.35)); }
.hoh-iteration-head { display: flex; justify-content: space-between; gap: 8px; font-weight: 600; }
/* Mirrors the shipped Button small+ghost metrics exactly, so this header action
 * is indistinguishable in size from one built on the primitive: the base is
 * 14px/22px, the small size is 12px/18px and 28px tall with 0 10px padding, a
 * 4px gap and no border. Values come from
 * @deepseek-ai/dsh-client-ui-primitives/lib/Button.module.css. */
.hoh-header-button {
  box-sizing: border-box;
  display: inline-flex; align-items: center; justify-content: center;
  gap: 4px; height: 28px; padding: 0 10px;
  border: none; border-radius: var(--dsw-radius-sm, 8px);
  background: transparent; cursor: pointer;
  font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-primary, inherit);
}
.hoh-header-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); }
.hoh-header-button:active:not(:disabled) { background: var(--dsw-alias-interactive-bg-active, rgba(127,127,127,.18)); }
.hoh-header-button:disabled { cursor: not-allowed; opacity: .4; }
.hoh-header-button:focus-visible { outline: 1px solid var(--dsw-alias-brand-primary, currentColor); }
.hoh-header-icon { display: inline-flex; width: 16px; height: 16px; align-items: center; justify-content: center; }

/* The conversation header runs out of room on narrow viewports; the label
 * collapses to the icon, matching the Dayflow action beside it. */
@media (max-width: 720px) {
  .hoh-header-label { display: none; }
  .hoh-header-button { padding: 0 6px; }
}
.hoh-banner { border-radius: 6px; padding: 8px; border: 1px solid; }
.hoh-banner[data-kind="error"] { border-color: var(--dsw-alias-state-error-primary, currentColor); color: var(--dsw-alias-state-error-primary, inherit); }
.hoh-banner[data-kind="empty"] { border-color: var(--dsw-alias-border-l1, rgba(127,127,127,.35)); color: var(--dsw-alias-label-secondary, inherit); }
`;
function installStyles() {
  if (document.getElementById(STYLE_ID) !== null) return () => {
  };
  const element = document.createElement("style");
  element.id = STYLE_ID;
  element.textContent = CSS;
  document.head.appendChild(element);
  return () => {
    element.remove();
  };
}

// client/toggle.jsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function LoopGlyph() {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { width: "16", height: "16", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("rect", { x: "1.5", y: "1.5", width: "13", height: "13", rx: "3", stroke: "currentColor", strokeWidth: "1.3" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("rect", { x: "5", y: "5", width: "6", height: "6", rx: "1.6", stroke: "currentColor", strokeWidth: "1.3", opacity: "0.75" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "8", cy: "8", r: "1.1", fill: "currentColor" })
  ] });
}
function HohToggle({ openPanel, t }) {
  const translate = (key) => typeof t === "function" ? t(key) : EN[key] ?? key;
  const label = translate("open");
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "button",
    {
      type: "button",
      className: "hoh-header-button",
      title: label,
      "aria-label": label,
      onClick: openPanel,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "hoh-header-icon", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(LoopGlyph, {}) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "hoh-header-label", children: translate("button") })
      ]
    }
  );
}

// client/index.jsx
var name = "harness-of-harness-panel";
var inject = ["slots", "locale", "sidebarRight", "sidebarRightTabs"];
var TAB_ID = "dsh-plugin-harness-of-harness";
var TAB_KIND = "hoh.run";
function registerPanelUi(ctx) {
  const label = (key) => ctx.locale.resolveText({ zh: ZH[key] ?? key, en: EN[key] ?? key });
  ctx.effect(
    () => ctx.sidebarRightTabs.register({
      id: TAB_ID,
      kind: TAB_KIND,
      priority: "extension",
      title: () => "Harness of Harness",
      guide: [
        {
          id: TAB_KIND,
          order: 43,
          title: () => label("guideTitle"),
          description: () => label("guideDescription")
        }
      ]
    }),
    "harness-of-harness panel: tab type"
  );
  ctx.effect(
    () => ctx.slots.inject(
      "sidebar.right.pane.tab",
      () => ctx.slots.register(
        {
          name: "sidebar.right.pane.tab",
          key: TAB_ID,
          locale: LOCALE_NAMESPACE
        },
        HohPanel
      )
    ),
    "harness-of-harness panel: body"
  );
  ctx.effect(
    () => ctx.slots.inject(
      "conversation.session.header.actions",
      () => ctx.slots.register(
        {
          name: "conversation.session.header.actions",
          id: "hoh-toggle",
          order: 16,
          locale: LOCALE_NAMESPACE,
          inject: () => ({ openPanel: () => ctx.sidebarRight.openTab(TAB_KIND) })
        },
        HohToggle
      )
    ),
    "harness-of-harness panel: toggle"
  );
}
function apply(ctx) {
  ctx.effect(() => installStyles(), "harness-of-harness panel: styles");
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, "zh", ZH), "harness-of-harness panel: zh");
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, "en", EN), "harness-of-harness panel: en");
  let settled = false;
  ctx.effect(
    () => () => {
      settled = true;
    },
    "harness-of-harness panel: lifecycle"
  );
  const register = () => {
    if (settled) return;
    settled = true;
    registerPanelUi(ctx);
  };
  fetchConfig().then(
    (config) => {
      if (config?.enabled) register();
    },
    (cause) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!/\(404\)|\(403\)/.test(message)) register();
    }
  );
}

		return module.exports;
	}
});

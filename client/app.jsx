/**
 * The Harness of Harness panel body.
 *
 * It is both the mode switch and the run monitor: with no run it collects the
 * requirements, the project directory, and the iteration budget; with a live
 * run it follows the three roles of the current iteration and then the
 * completed history.
 * @module dsh-plugin-harness-of-harness/client/app
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ROLES } from '../src/contract.js';
import { fetchConfig, fetchState, startRun, stopRun } from './data.js';
import { clockTime, elapsed, fill } from './format.js';
import { EN } from './locale.js';

/** How often a live run is re-read, in milliseconds. */
const POLL_MS = 1500;

/** How many log lines the panel shows. */
const LOG_LINES = 40;

/**
 * Resolve one copy key through the injected translator, falling back to the
 * bundled English dictionary.
 * @param t - the namespace-bound translator, when injected.
 * @param key - the copy key.
 * @returns the copy string.
 */
function text(t, key) {
  if (typeof t === 'function') {
    const resolved = t(key);
    if (typeof resolved === 'string' && resolved !== '' && resolved !== key) return resolved;
  }
  return EN[key] ?? key;
}

/**
 * The status chip label for one run status.
 * @param t - the translator.
 * @param status - the run status.
 * @returns the label.
 */
function runStatusLabel(t, status) {
  switch (status) {
    case 'running':
      return text(t, 'statusRunning');
    case 'stopping':
      return text(t, 'statusStopping');
    case 'stopped':
      return text(t, 'statusStopped');
    case 'done':
      return text(t, 'statusDone');
    case 'error':
      return text(t, 'statusError');
    default:
      return status;
  }
}

/**
 * The label of one role.
 * @param t - the translator.
 * @param role - the role key.
 * @returns the label.
 */
function roleLabel(t, role) {
  if (role === 'planner') return text(t, 'rolePlanner');
  if (role === 'developer') return text(t, 'roleDeveloper');
  if (role === 'tester') return text(t, 'roleTester');
  return role;
}

/**
 * The label of one role turn's state.
 * @param t - the translator.
 * @param status - the phase status.
 * @returns the label.
 */
function phaseLabel(t, status) {
  switch (status) {
    case 'pending':
      return text(t, 'phasePending');
    case 'running':
      return text(t, 'phaseRunning');
    case 'done':
      return text(t, 'phaseDone');
    case 'failed':
      return text(t, 'phaseFailed');
    case 'skipped':
      return text(t, 'phaseSkipped');
    default:
      return status;
  }
}

/**
 * Render one role turn.
 * @param props - the turn and the translator.
 * @returns the row.
 */
function PhaseRow({ phase, now, t }) {
  const state = phase.status ?? 'pending';
  const round = typeof phase.round === 'number' ? phase.round : 0;
  const verdict = phase.verdict ?? null;
  return (
    <div className="hoh-step" data-state={state}>
      <span className="hoh-dot" style={{ alignSelf: 'center' }} />
      <span className="hoh-step-name">{roleLabel(t, phase.role)}</span>
      <span className="hoh-step-state">
        {phaseLabel(t, state)}
        {round > 0 ? ` · ${fill(text(t, 'repair'), { n: round })}` : ''}
        {phase.startedAt !== undefined && phase.startedAt !== null
          ? ` · ${elapsed(phase.startedAt, phase.endedAt ?? now)}`
          : ''}
      </span>
      {verdict !== null ? (
        <div className="hoh-meta hoh-summary">
          {verdict.passed
            ? text(t, 'verdictPassed')
            : fill(text(t, 'verdictFailed'), { gaps: (verdict.gaps ?? []).length })}
        </div>
      ) : null}
      {phase.summary !== undefined && phase.summary !== '' ? (
        <div className="hoh-summary">{phase.summary}</div>
      ) : null}
      {phase.reason !== undefined && phase.reason !== null && phase.reason !== '' ? (
        <div className="hoh-summary">{phase.reason}</div>
      ) : null}
      {phase.childId !== undefined && phase.childId !== null && phase.childId !== '' ? (
        <div className="hoh-meta hoh-summary">{fill(text(t, 'currentChild'), { id: phase.childId })}</div>
      ) : null}
    </div>
  );
}

/**
 * Render one completed iteration.
 * @param props - the iteration, its run, and the translator.
 * @returns the card.
 */
function IterationCard({ iteration, run, now, t }) {
  return (
    <div className="hoh-iteration">
      <div className="hoh-iteration-head">
        <span>{fill(text(t, 'iterationOf'), { index: iteration.index, total: run.iterations })}</span>
        <span className="hoh-step-state">
          {iteration.endedAt === null
            ? elapsed(iteration.startedAt, now)
            : elapsed(iteration.startedAt, iteration.endedAt)}
        </span>
      </div>
      {(iteration.phases ?? []).length === 0 ? (
        <div className="hoh-meta">{text(t, 'noHistory')}</div>
      ) : (
        (iteration.phases ?? []).map((phase) => <PhaseRow key={phase.role} phase={phase} now={now} t={t} />)
      )}
      <div className="hoh-meta">
        {`${run.runDir}/iteration-${iteration.index}/plan.md`}
        {' · '}
        {`${run.runDir}/iteration-${iteration.index}/evidence.md`}
      </div>
    </div>
  );
}

/**
 * Render the panel.
 * @param props - the slot's session id and the injected translator.
 * @returns the panel body.
 */
export function HohPanel({ sessionId, t }) {
  const [config, setConfig] = useState(undefined);
  const [configError, setConfigError] = useState('');
  const [run, setRun] = useState(null);
  const [runError, setRunError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  const [goal, setGoal] = useState('');
  const [projectDir, setProjectDir] = useState('');
  const [iterations, setIterations] = useState(3);

  const [now, setNow] = useState(() => Date.now());
  const seeded = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchConfig(controller.signal).then(
      (answer) => {
        if (controller.signal.aborted) return;
        setConfig(answer);
        setConfigError('');
        if (!seeded.current && answer?.defaults) {
          seeded.current = true;
          setProjectDir(answer.defaults.projectDir ?? '');
          setIterations(answer.defaults.iterations ?? 3);
        }
      },
      (cause) => {
        if (controller.signal.aborted) return;
        setConfigError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      controller.abort();
    };
  }, [nonce]);

  const enabled = config?.enabled !== false;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    fetchState(sessionId, controller.signal).then(
      (answer) => {
        if (controller.signal.aborted) return;
        setRun(answer?.run ?? null);
        setRunError('');
        setLoading(false);
      },
      (cause) => {
        if (controller.signal.aborted) return;
        setRunError(cause instanceof Error ? cause.message : String(cause));
        setLoading(false);
      },
    );
    return () => {
      controller.abort();
    };
  }, [enabled, sessionId, nonce]);

  const live = run !== null && (run.status === 'running' || run.status === 'stopping');

  useEffect(() => {
    if (!live) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
    };
  }, [live]);

  useEffect(() => {
    if (!live) return undefined;
    const controller = new AbortController();
    const timer = setInterval(() => {
      fetchState(sessionId, controller.signal).then(
        (answer) => {
          if (controller.signal.aborted) return;
          setRun(answer?.run ?? null);
          setRunError('');
        },
        (cause) => {
          if (controller.signal.aborted) return;
          setRunError(cause instanceof Error ? cause.message : String(cause));
        },
      );
    }, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [live, sessionId]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  const onStart = useCallback(() => {
    setBusy(true);
    setRunError('');
    const request = {
      sessionId,
      goal,
      projectDir,
      iterations: Number.isInteger(iterations) ? iterations : Number(iterations) || 1,
    };
    startRun(request).then(
      (answer) => {
        setBusy(false);
        setRun(answer?.run ?? null);
      },
      (cause) => {
        setBusy(false);
        setRunError(cause instanceof Error ? cause.message : String(cause));
      },
    );
  }, [goal, iterations, projectDir, sessionId]);

  const onStop = useCallback(() => {
    setBusy(true);
    setRunError('');
    stopRun(sessionId).then(
      (answer) => {
        setBusy(false);
        if (answer?.run) setRun(answer.run);
        else refresh();
      },
      (cause) => {
        setBusy(false);
        setRunError(cause instanceof Error ? cause.message : String(cause));
      },
    );
  }, [refresh, sessionId]);

  const current = run !== null && run.history !== undefined && run.history.length > 0
    ? run.history[run.history.length - 1]
    : undefined;

  const logLines = useMemo(() => {
    if (run === null || !Array.isArray(run.log)) return [];
    return run.log.slice(-LOG_LINES);
  }, [run]);

  if (configError !== '' && config === undefined) {
    return (
      <div className="hoh-root">
        <div className="hoh-head">
          <span className="hoh-title">{text(t, 'title')}</span>
          <span className="hoh-sub">{text(t, 'subtitle')}</span>
        </div>
        <div className="hoh-banner" data-kind="error">{configError}</div>
        <div className="hoh-actions">
          <button type="button" className="hoh-button" onClick={refresh}>
            {text(t, 'retry')}
          </button>
        </div>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="hoh-root">
        <div className="hoh-head">
          <span className="hoh-title">{text(t, 'title')}</span>
          <span className="hoh-sub">{text(t, 'subtitle')}</span>
        </div>
        <div className="hoh-banner" data-kind="empty">{text(t, 'modeOff')}</div>
      </div>
    );
  }

  return (
    <div className="hoh-root">
      <div className="hoh-head">
        <span className="hoh-title">{text(t, 'title')}</span>
        <span className="hoh-sub">{text(t, 'subtitle')}</span>
      </div>

      <span className="hoh-chip" data-status={run === null ? 'idle' : run.status}>
        <span className="hoh-dot" />
        {run === null ? text(t, 'modeOff') : runStatusLabel(t, run.status)}
      </span>

      {runError !== '' ? <div className="hoh-banner" data-kind="error">{runError}</div> : null}

      {run !== null && run.error !== null && run.error !== undefined && run.error !== '' ? (
        <div className="hoh-banner" data-kind="error">{run.error}</div>
      ) : null}

      {live ? (
        <div className="hoh-card">
          <div className="hoh-row" style={{ justifyContent: 'space-between' }}>
            <span className="hoh-step-name">
              {fill(text(t, 'iterationOf'), { index: run.currentIteration, total: run.iterations })}
            </span>
            <span className="hoh-meta">{fill(text(t, 'elapsed'), { time: elapsed(run.startedAt, now) })}</span>
          </div>
          <div className="hoh-pipeline">
            {ROLES.map((role) => {
              // A repair turn repeats a role, so the newest turn is the one in force.
              const phase = [...(current?.phases ?? [])].reverse().find((entry) => entry.role === role);
              return (
                <PhaseRow
                  key={role}
                  phase={phase ?? { role, status: 'pending' }}
                  now={now}
                  t={t}
                />
              );
            })}
          </div>
          <div className="hoh-actions">
            <button
              type="button"
              className="hoh-button"
              data-primary="true"
              disabled={busy || run.status === 'stopping'}
              onClick={onStop}
            >
              {text(t, 'stop')}
            </button>
            <button type="button" className="hoh-button" onClick={refresh}>
              {text(t, 'refresh')}
            </button>
          </div>
        </div>
      ) : (
        <div className="hoh-card">
          <div className="hoh-field">
            <label className="hoh-label" htmlFor="hoh-goal">{text(t, 'goal')}</label>
            <textarea
              id="hoh-goal"
              className="hoh-textarea"
              value={goal}
              placeholder={text(t, 'goalPlaceholder')}
              onChange={(event) => setGoal(event.target.value)}
            />
          </div>
          <div className="hoh-field">
            <label className="hoh-label" htmlFor="hoh-dir">{text(t, 'projectDir')}</label>
            <input
              id="hoh-dir"
              className="hoh-input"
              value={projectDir}
              onChange={(event) => setProjectDir(event.target.value)}
            />
          </div>
          <div className="hoh-field">
            <label className="hoh-label" htmlFor="hoh-iterations">{text(t, 'iterations')}</label>
            <input
              id="hoh-iterations"
              className="hoh-input"
              type="number"
              min="1"
              max="50"
              value={iterations}
              onChange={(event) => setIterations(Number(event.target.value))}
            />
          </div>
          <div className="hoh-actions">
            <button
              type="button"
              className="hoh-button"
              data-primary="true"
              disabled={busy || goal.trim() === ''}
              onClick={onStart}
            >
              {run === null ? text(t, 'start') : text(t, 'restart')}
            </button>
          </div>
        </div>
      )}

      {loading && run === null ? <div className="hoh-meta">{text(t, 'loading')}</div> : null}

      {run === null && !loading ? <div className="hoh-banner" data-kind="empty">{text(t, 'empty')}</div> : null}

      {logLines.length > 0 ? (
        <div className="hoh-field">
          <span className="hoh-label">{text(t, 'log')}</span>
          <div className="hoh-log">
            {logLines.map((line, index) => (
              <div className="hoh-log-line" data-level={line.level} key={`${line.time}-${index}`}>
                <span className="hoh-log-time">{clockTime(line.time)}</span>
                <span>{line.text}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {run !== null && run.history !== undefined && run.history.length > 0 ? (
        <div className="hoh-field">
          <span className="hoh-label">{text(t, 'history')}</span>
          <div className="hoh-pipeline">
            {run.history
              .slice()
              .reverse()
              .map((iteration) => (
                <IterationCard
                  key={iteration.index}
                  iteration={iteration}
                  run={run}
                  now={now}
                  t={t}
                />
              ))}
          </div>
        </div>
      ) : null}

      {run !== null ? (
        <div className="hoh-meta">
          {text(t, 'runDir')}: {run.runDir}
        </div>
      ) : null}
    </div>
  );
}
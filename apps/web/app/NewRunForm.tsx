'use client';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createRunAction, type RunFormState } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="primary" type="submit" disabled={pending}>
      {pending ? 'running fan-out…' : 'Run search'}
    </button>
  );
}

export function NewRunForm({ disabled }: { disabled: boolean }) {
  const [state, action] = useActionState<RunFormState, FormData>(createRunAction, {});
  return (
    <form action={action}>
      <div className="row">
        <input
          name="query"
          placeholder='e.g. "solid state battery suppliers"'
          style={{ flex: 1, minWidth: 240 }}
          required
          disabled={disabled}
        />
        <input name="location" placeholder="location (optional)" style={{ width: 160 }} disabled={disabled} />
        <label className="dim small row" style={{ gap: 6 }}>
          budget
          <input name="budget" type="number" defaultValue={24} min={1} max={60} style={{ width: 70 }} disabled={disabled} />
        </label>
        <label className="dim small row" style={{ gap: 6 }}>
          <input name="llm" type="checkbox" style={{ width: 'auto' }} disabled={disabled} />
          LLM expand
        </label>
        <SubmitButton />
      </div>
      <p className="dim small" style={{ marginBottom: 0 }}>
        Runs synchronously — a 24-probe fan-out takes ~10–30s. The page redirects to the report when done.
      </p>
      {state.error && (
        <p className="notice error small" style={{ marginTop: 10 }}>
          {state.error}
        </p>
      )}
    </form>
  );
}
